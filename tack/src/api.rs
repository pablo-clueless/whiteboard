//! REST endpoints for boards and share links. Tokens travel in `Authorization: Bearer …`.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Role, hash_token, new_token},
    db,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/boards", post(create_board))
        .route("/api/boards/{board_id}", get(get_board))
        .route("/api/boards/{board_id}/tokens", post(rotate_tokens))
        .route("/api/boards/{board_id}/links", post(create_link))
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("this link doesn't give access to the board")]
    Forbidden,
    #[error("only people with an edit link can do that")]
    EditOnly,
    #[error("board not found")]
    NotFound,
    #[error("server error")]
    Db(#[from] sqlx::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Forbidden | Self::EditOnly => StatusCode::FORBIDDEN,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Db(err) => {
                tracing::error!(%err, "database error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (status, Json(serde_json::json!({ "error": self.to_string() }))).into_response()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareLinks {
    board_id: Uuid,
    edit_token: String,
    view_token: String,
}

/// Creates an empty board and returns its edit and view tokens. They're only ever shown here.
async fn create_board(State(state): State<AppState>) -> Result<(StatusCode, Json<ShareLinks>), ApiError> {
    let board_id = Uuid::new_v4();
    let (edit_token, edit_hash) = new_token();
    let (view_token, view_hash) = new_token();
    db::create_board(&state.pool, board_id, &edit_hash, &view_hash).await?;
    tracing::info!(%board_id, "board created");
    Ok((StatusCode::CREATED, Json(ShareLinks { board_id, edit_token, view_token })))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardInfo {
    board_id: Uuid,
    title: String,
    schema_version: i32,
    role: Role,
}

async fn get_board(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<BoardInfo>, ApiError> {
    let role = authorize(&state, board_id, &headers).await?;
    let board = db::board(&state.pool, board_id).await?.ok_or(ApiError::NotFound)?;
    Ok(Json(BoardInfo { board_id, title: board.title, schema_version: board.schema_version, role }))
}

/// Replaces both share links. Everyone connected is disconnected and must use a new link.
async fn rotate_tokens(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<ShareLinks>, ApiError> {
    if authorize(&state, board_id, &headers).await? != Role::Edit {
        return Err(ApiError::EditOnly);
    }
    let (edit_token, edit_hash) = new_token();
    let (view_token, view_hash) = new_token();
    db::rotate_tokens(&state.pool, board_id, &edit_hash, &view_hash).await?;
    state.rooms.disconnect_all(board_id).await;
    tracing::info!(%board_id, "share links rotated");
    Ok(Json(ShareLinks { board_id, edit_token, view_token }))
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
    Json(body): Json<NewLink>,
) -> Result<Json<Link>, ApiError> {
    if authorize(&state, board_id, &headers).await? != Role::Edit {
        return Err(ApiError::EditOnly);
    }
    let (token, hash) = new_token();
    db::add_token(&state.pool, board_id, &hash, body.role).await?;
    Ok(Json(Link { token, role: body.role }))
}

/// The role the request's bearer token grants on the board.
async fn authorize(state: &AppState, board_id: Uuid, headers: &HeaderMap) -> Result<Role, ApiError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if let Some(token) = token
        && let Some(role) = db::token_role(&state.pool, board_id, &hash_token(token)).await?
    {
        return Ok(role);
    }
    match db::board(&state.pool, board_id).await? {
        Some(_) => Err(ApiError::Forbidden),
        None => Err(ApiError::NotFound),
    }
}
