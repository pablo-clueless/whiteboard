//! REST endpoints for boards and share links. Tokens travel in `Authorization: Bearer …`.

use axum::{
    Json, Router,
    body::Bytes,
    extract::DefaultBodyLimit,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use uuid::Uuid;

use crate::{
    AppState,
    accounts::MaybeUser,
    audit,
    auth::{Role, hash_token, new_token},
    db,
    request_meta::RequestMeta,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/boards", post(create_board))
        .route("/api/boards/{board_id}", get(get_board))
        .route("/api/boards/{board_id}/tokens", post(rotate_tokens))
        .route("/api/boards/{board_id}/links", post(create_link))
        .route("/api/boards/{board_id}/lock", put(set_locked))
        .route(
            "/api/boards/{board_id}/assets",
            // Room for the largest allowed image; anything bigger is refused before it is read.
            post(upload_asset).layer(DefaultBodyLimit::max(MAX_ASSET_BYTES + 1024)),
        )
        .route("/api/assets/{asset_id}", get(serve_asset))
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("this link doesn't give access to the board")]
    Forbidden,
    #[error("only people with an edit link can do that")]
    EditOnly,
    #[error("board not found")]
    NotFound,
    #[error("images can be at most 5 MB")]
    TooLarge,
    #[error("only PNG, JPEG, WebP and GIF images are supported")]
    UnsupportedImage,
    #[error("sign in to do that")]
    Unauthorized,
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("too many failed sign-ins; try again in a few minutes")]
    TooManyAttempts,
    #[error("{0}")]
    Denied(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Unavailable(String),
    /// One field of a form is wrong; `field` names it so the client can show the message beside it.
    #[error("{message}")]
    Invalid { field: &'static str, message: String },
    /// An admin who must set up two-factor sign-in before using the admin interface.
    #[error("set up two-factor authentication to use the admin")]
    TwoFactorRequired,
    #[error("server error")]
    Internal(String),
    #[error("server error")]
    Db(#[from] sqlx::Error),
}

impl From<crate::settings::UpdateError> for ApiError {
    fn from(err: crate::settings::UpdateError) -> Self {
        match err {
            crate::settings::UpdateError::Invalid { field: Some(field), message } => {
                Self::Invalid { field, message }
            }
            crate::settings::UpdateError::Invalid { field: None, message } => Self::BadRequest(message),
            crate::settings::UpdateError::Db(err) => Self::Db(err),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Forbidden | Self::EditOnly | Self::Denied(_) | Self::TwoFactorRequired => {
                StatusCode::FORBIDDEN
            }
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::UnsupportedImage => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::Unauthorized | Self::InvalidCredentials => StatusCode::UNAUTHORIZED,
            Self::TooManyAttempts => StatusCode::TOO_MANY_REQUESTS,
            Self::BadRequest(_) | Self::Invalid { .. } => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::Internal(err) => {
                tracing::error!(%err, "internal error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
            Self::Db(err) => {
                tracing::error!(%err, "database error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        let mut body = serde_json::json!({ "error": self.to_string() });
        match &self {
            Self::Invalid { field, .. } => body["field"] = (*field).into(),
            // A stable code, so the client can tell this 403 from the rest.
            Self::TwoFactorRequired => body["code"] = "two_factor_required".into(),
            _ => {}
        }
        (status, Json(body)).into_response()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareLinks {
    board_id: Uuid,
    edit_token: String,
    view_token: String,
}

/// Refuses with 503 in maintenance mode, unless an admin is asking.
pub fn check_maintenance(
    state: &AppState,
    user: Option<&crate::accounts::User>,
) -> Result<(), ApiError> {
    if state.settings.read(|s| s.platform.maintenance_mode) && !user.is_some_and(|u| u.is_admin()) {
        return Err(ApiError::Unavailable("Tack is down for maintenance".into()));
    }
    Ok(())
}

/// Creates an empty board and returns its edit and view tokens. They're only ever shown here.
/// A signed-in caller becomes the board's owner.
async fn create_board(
    State(state): State<AppState>,
    MaybeUser(user): MaybeUser,
    meta: RequestMeta,
) -> Result<(StatusCode, Json<ShareLinks>), ApiError> {
    check_maintenance(&state, user.as_ref())?;
    if !state.settings.read(|s| s.board.new_board_creation)
        && !user.as_ref().is_some_and(|u| u.is_admin())
    {
        return Err(ApiError::Denied(
            "new boards can't be created right now".into(),
        ));
    }
    let board_id = Uuid::new_v4();
    let (edit_token, edit_hash) = new_token();
    let (view_token, view_hash) = new_token();
    db::create_board(
        &state.pool,
        board_id,
        user.as_ref().map(|u| u.id),
        &edit_hash,
        &view_hash,
    )
    .await?;
    tracing::info!(%board_id, "board created");
    let resource = format!("board:{board_id}");
    audit::record(
        &state.pool,
        user.as_ref(),
        "board.created",
        resource,
        serde_json::json!({}),
        Some(&meta),
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(ShareLinks {
            board_id,
            edit_token,
            view_token,
        }),
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardInfo {
    board_id: Uuid,
    title: String,
    schema_version: i32,
    role: Role,
    /// Archived boards are read-only for everyone.
    archived: bool,
    /// Locked read-only by an editor (and the read-only switch is on).
    locked: bool,
}

async fn get_board(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<BoardInfo>, ApiError> {
    let role = authorize(&state, board_id, &headers).await?;
    let board = db::board(&state.pool, board_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(BoardInfo {
        board_id,
        title: board.title,
        schema_version: board.schema_version,
        role,
        archived: board.archived_at.is_some(),
        locked: board.locked_at.is_some() && state.settings.read(|s| s.board.read_only_switch),
    }))
}

#[derive(Deserialize)]
struct LockBody {
    locked: bool,
}

/// The editor's read-only switch: locks the board so nobody can edit it until an editor unlocks
/// it. Refused while the board setting `readOnlySwitch` is off.
async fn set_locked(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    headers: HeaderMap,
    MaybeUser(user): MaybeUser,
    meta: RequestMeta,
    Json(body): Json<LockBody>,
) -> Result<StatusCode, ApiError> {
    if authorize(&state, board_id, &headers).await? != Role::Edit {
        return Err(ApiError::EditOnly);
    }
    if !state.settings.read(|s| s.board.read_only_switch) {
        return Err(ApiError::Denied("boards can't be locked right now".into()));
    }
    if !db::set_locked(&state.pool, board_id, body.locked).await? {
        return Err(ApiError::NotFound);
    }
    state.rooms.set_locked(board_id, body.locked).await;
    let action = if body.locked { "board.locked" } else { "board.unlocked" };
    let resource = format!("board:{board_id}");
    audit::record(&state.pool, user.as_ref(), action, resource, serde_json::json!({}), Some(&meta)).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Replaces both share links. Everyone connected is disconnected and must use a new link.
async fn rotate_tokens(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    headers: HeaderMap,
    meta: RequestMeta,
) -> Result<Json<ShareLinks>, ApiError> {
    if authorize(&state, board_id, &headers).await? != Role::Edit {
        return Err(ApiError::EditOnly);
    }
    let (edit_token, edit_hash) = new_token();
    let (view_token, view_hash) = new_token();
    db::rotate_tokens(&state.pool, board_id, &edit_hash, &view_hash).await?;
    state.rooms.disconnect_all(board_id).await;
    tracing::info!(%board_id, "share links rotated");
    let resource = format!("board:{board_id}");
    audit::record(
        &state.pool,
        None,
        "board.links_reset",
        resource,
        serde_json::json!({}),
        Some(&meta),
    )
    .await;
    Ok(Json(ShareLinks {
        board_id,
        edit_token,
        view_token,
    }))
}

#[derive(Deserialize)]
struct NewLink {
    role: Role,
}

#[derive(Serialize)]
struct Link {
    token: String,
    role: Role,
}

/// Adds another share link without revoking existing ones, e.g. so someone who joined with an
/// edit link can hand out a view link.
async fn create_link(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    headers: HeaderMap,
    meta: RequestMeta,
    Json(body): Json<NewLink>,
) -> Result<Json<Link>, ApiError> {
    if authorize(&state, board_id, &headers).await? != Role::Edit {
        return Err(ApiError::EditOnly);
    }
    let (token, hash) = new_token();
    db::add_token(&state.pool, board_id, &hash, body.role).await?;
    let (resource, metadata) = (
        format!("board:{board_id}"),
        serde_json::json!({ "role": body.role }),
    );
    audit::record(
        &state.pool,
        None,
        "board.link_created",
        resource,
        metadata,
        Some(&meta),
    )
    .await;
    Ok(Json(Link {
        token,
        role: body.role,
    }))
}

/// Largest image accepted.
const MAX_ASSET_BYTES: usize = 5 * 1024 * 1024;

/// The image type from the file's first bytes. The Content-Type header is never trusted.
fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', b'7' | b'9', b'a', ..] => Some("image/gif"),
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => Some("image/webp"),
        _ => None,
    }
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn unhex(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(s.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadedAsset {
    asset_id: String,
    mime: &'static str,
    size: usize,
}

/// Stores an image for a board. Same bytes, same id: uploading an image twice stores it once.
async fn upload_asset(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<UploadedAsset>), ApiError> {
    check_maintenance(&state, None)?;
    if !state.settings.read(|s| s.board.image_uploads) {
        return Err(ApiError::Denied("image uploads are turned off".into()));
    }
    if authorize(&state, board_id, &headers).await? != Role::Edit {
        return Err(ApiError::EditOnly);
    }
    if body.len() > MAX_ASSET_BYTES {
        return Err(ApiError::TooLarge);
    }
    let mime = sniff_image(&body).ok_or(ApiError::UnsupportedImage)?;
    let id: [u8; 32] = sha2::Sha256::digest(&body).into();
    let created = db::insert_asset(&state.pool, &id, board_id, mime, &body).await?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((
        status,
        Json(UploadedAsset {
            asset_id: hex(&id),
            mime,
            size: body.len(),
        }),
    ))
}

/// Serves an image. Ids are content hashes, so a response never changes: cache it forever.
async fn serve_asset(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
) -> Result<Response, ApiError> {
    let id = unhex(&asset_id).ok_or(ApiError::NotFound)?;
    let (mime, bytes) = db::asset(&state.pool, &id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (
                header::CACHE_CONTROL,
                "public, max-age=31536000, immutable".to_owned(),
            ),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'".to_owned(),
            ),
        ],
        bytes,
    )
        .into_response())
}

/// The role the request's bearer token grants on the board. Archived boards only grant view.
async fn authorize(
    state: &AppState,
    board_id: Uuid,
    headers: &HeaderMap,
) -> Result<Role, ApiError> {
    if let Some(token) = crate::accounts::bearer(headers)
        && let Some(role) = db::token_role(&state.pool, board_id, &hash_token(token)).await?
    {
        return Ok(role);
    }
    match db::board(&state.pool, board_id).await? {
        Some(_) => Err(ApiError::Forbidden),
        None => Err(ApiError::NotFound),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_images_by_content_not_name() {
        assert_eq!(
            sniff_image(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]),
            Some("image/png")
        );
        assert_eq!(sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff_image(b"GIF89a...."), Some("image/gif"));
        assert_eq!(sniff_image(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(
            sniff_image(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
            None
        );
        assert_eq!(sniff_image(b"RIFF\0\0\0\0WAVEfmt "), None);
        assert_eq!(sniff_image(b""), None);
    }

    #[test]
    fn asset_ids_round_trip_and_reject_junk() {
        let id: [u8; 32] = sha2::Sha256::digest(b"hello").into();
        assert_eq!(unhex(&hex(&id)), Some(id));
        assert_eq!(unhex("zz"), None);
        assert_eq!(unhex(&"g".repeat(64)), None);
    }
}
