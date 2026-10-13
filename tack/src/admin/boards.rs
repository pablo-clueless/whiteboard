//! The boards page: boards, their share links and live room, and the asset browser.

use std::collections::HashSet;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
use yrs::{Any, Doc, ReadTxn, Transact, Update, types::ToJson, updates::decoder::Decode};

use super::{Page, Stat, like_pattern, list_param, order, paging, period_bounds, period_days};
use crate::{
    AppState,
    accounts::{AdminUser, User},
    api::{ApiError, hex, unhex},
    audit,
    auth::{Role, new_token},
    db,
    request_meta::RequestMeta,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/boards", get(list))
        .route("/api/admin/boards/stats", get(stats))
        .route("/api/admin/boards/bulk", post(bulk))
        .route("/api/admin/boards/{id}", get(detail).patch(update).delete(remove))
        .route("/api/admin/boards/{id}/archive", post(archive))
        .route("/api/admin/boards/{id}/unarchive", post(unarchive))
        .route("/api/admin/boards/{id}/tokens", get(tokens).post(create_token))
        .route("/api/admin/boards/{id}/tokens/{token_id}", delete(revoke_token))
        .route("/api/admin/assets", get(assets))
        .route("/api/admin/assets/orphans", get(orphans).delete(delete_orphans))
        .route("/api/admin/assets/{asset_id}", delete(delete_asset))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum BoardStatus {
    Active,
    Archived,
}

/// Matches `Board` in the web client, plus sizes and counts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Board {
    id: Uuid,
    name: String,
    /// The owner's name, if the board has one.
    owner: Option<String>,
    owner_id: Option<Uuid>,
    owner_email: Option<String>,
    status: BoardStatus,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    archived_at: Option<DateTime<Utc>>,
    /// Locked read-only from the editor. Only enforced while the read-only switch is on.
    locked_at: Option<DateTime<Utc>>,
    /// Stored doc size: snapshot plus updates since.
    size_bytes: i64,
    asset_count: i64,
    asset_bytes: i64,
    link_count: i64,
    /// Clients connected right now.
    connected: usize,
}

#[derive(sqlx::FromRow)]
struct BoardRow {
    id: Uuid,
    title: String,
    owner_id: Option<Uuid>,
    owner_name: Option<String>,
    owner_email: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    archived_at: Option<DateTime<Utc>>,
    locked_at: Option<DateTime<Utc>>,
    size_bytes: i64,
    asset_count: i64,
    asset_bytes: i64,
    link_count: i64,
}

impl BoardRow {
    fn into_board(self, state: &AppState) -> Board {
        Board {
            connected: state.rooms.client_count(self.id),
            id: self.id,
            name: self.title,
            owner: self.owner_name,
            owner_id: self.owner_id,
            owner_email: self.owner_email,
            status: if self.archived_at.is_some() { BoardStatus::Archived } else { BoardStatus::Active },
            created_at: self.created_at,
            updated_at: self.updated_at,
            archived_at: self.archived_at,
            locked_at: self.locked_at,
            size_bytes: self.size_bytes,
            asset_count: self.asset_count,
            asset_bytes: self.asset_bytes,
            link_count: self.link_count,
        }
    }
}

/// Selects [`BoardRow`]s; `{where}` and `{tail}` are filled in by the caller.
const BOARD_SELECT: &str = "SELECT b.id, b.title, b.owner_id, u.name AS owner_name, u.email AS owner_email,
       b.created_at, b.updated_at, b.archived_at, b.locked_at,
       (COALESCE((SELECT length(state) FROM board_snapshots s WHERE s.board_id = b.id), 0)
        + COALESCE((SELECT sum(length(update)) FROM board_updates bu WHERE bu.board_id = b.id), 0))::bigint AS size_bytes,
       (SELECT count(*) FROM assets a WHERE a.board_id = b.id) AS asset_count,
       COALESCE((SELECT sum(size) FROM assets a WHERE a.board_id = b.id), 0)::bigint AS asset_bytes,
       (SELECT count(*) FROM share_tokens t WHERE t.board_id = b.id) AS link_count
     FROM boards b LEFT JOIN users u ON u.id = b.owner_id";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListParams {
    page: Option<i64>,
    limit: Option<i64>,
    /// Matches the title, the id, or the owner's name or email.
    search: Option<String>,
    /// Comma-separated: active, archived.
    status: Option<String>,
    owner_id: Option<Uuid>,
    /// name, createdAt, updatedAt (default) or size.
    sort: Option<String>,
    order: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(p): Query<ListParams>,
) -> Result<Json<Page<Board>>, ApiError> {
    let (page, limit, offset) = paging(p.page, p.limit);
    let sort = match p.sort.as_deref() {
        Some("name") => "b.title",
        Some("createdAt") => "b.created_at",
        Some("size") => "size_bytes",
        _ => "b.updated_at",
    };
    let filter = "WHERE ($1::text IS NULL OR b.title ILIKE $1 OR b.id::text ILIKE $1 OR u.name ILIKE $1 OR u.email ILIKE $1)
        AND ($2::text[] IS NULL OR (CASE WHEN b.archived_at IS NULL THEN 'active' ELSE 'archived' END) = ANY($2))
        AND ($3::uuid IS NULL OR b.owner_id = $3)";
    let search = like_pattern(p.search.as_deref());
    let status = list_param(p.status.as_deref());

    let total: i64 = sqlx::query_scalar(crate::db::audited(format!(
        "SELECT count(*) FROM boards b LEFT JOIN users u ON u.id = b.owner_id {filter}"
    )))
    .bind(&search)
    .bind(&status)
    .bind(p.owner_id)
    .fetch_one(&state.pool)
    .await?;
    let rows: Vec<BoardRow> = sqlx::query_as(crate::db::audited(format!(
        "{BOARD_SELECT} {filter} ORDER BY {sort} {}, b.id LIMIT $4 OFFSET $5",
        order(p.order.as_deref())
    )))
    .bind(&search)
    .bind(&status)
    .bind(p.owner_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(Page { data: rows.into_iter().map(|r| r.into_board(&state)).collect(), total, page, limit }))
}

#[derive(Deserialize)]
struct PeriodParams {
    period: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardStats {
    period: i64,
    /// All boards, against the count at the start of the period.
    total_boards: Stat,
    /// Boards someone opened in the period.
    active_boards: Stat,
    /// Distinct visitors who opened a board in the period.
    collaborators: Stat,
    /// Archived boards, against the count at the start of the period.
    archived_boards: Stat,
    open_rooms: usize,
}

async fn stats(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(p): Query<PeriodParams>,
) -> Result<Json<BoardStats>, ApiError> {
    let days = period_days(p.period);
    let (prev, start, now) = period_bounds(days);
    let (total, total_before, archived, archived_before): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT count(*), count(*) FILTER (WHERE created_at < $1),
                count(*) FILTER (WHERE archived_at IS NOT NULL),
                count(*) FILTER (WHERE archived_at < $1)
         FROM boards",
    )
    .bind(start)
    .fetch_one(&state.pool)
    .await?;
    let (active, prev_active, collaborators, prev_collaborators): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT count(DISTINCT board_id) FILTER (WHERE started_at >= $2),
                count(DISTINCT board_id) FILTER (WHERE started_at < $2),
                count(DISTINCT visitor_id) FILTER (WHERE started_at >= $2),
                count(DISTINCT visitor_id) FILTER (WHERE started_at < $2)
         FROM connections WHERE started_at >= $1 AND started_at < $3",
    )
    .bind(prev)
    .bind(start)
    .bind(now)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(BoardStats {
        period: days,
        total_boards: Stat::new(total, total_before),
        active_boards: Stat::new(active, prev_active),
        collaborators: Stat::new(collaborators, prev_collaborators),
        archived_boards: Stat::new(archived, archived_before),
        open_rooms: state.rooms.open_rooms(),
    }))
}

async fn find(state: &AppState, id: Uuid) -> Result<Board, ApiError> {
    let row: Option<BoardRow> = sqlx::query_as(crate::db::audited(format!("{BOARD_SELECT} WHERE b.id = $1")))
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    Ok(row.ok_or(ApiError::NotFound)?.into_board(state))
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ShareLink {
    /// The token's hash, hex. Identifies the link without revealing it.
    id: String,
    role: String,
    created_at: DateTime<Utc>,
}

async fn load_links(pool: &PgPool, board_id: Uuid) -> sqlx::Result<Vec<ShareLink>> {
    sqlx::query_as(
        "SELECT encode(token_hash, 'hex') AS id, role, created_at FROM share_tokens WHERE board_id = $1 ORDER BY created_at",
    )
    .bind(board_id)
    .fetch_all(pool)
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardDetail {
    #[serde(flatten)]
    board: Board,
    schema_version: i32,
    snapshot_at: Option<DateTime<Utc>>,
    /// Stored updates not yet folded into the snapshot.
    pending_updates: i64,
    links: Vec<ShareLink>,
    /// Connections in the last 30 days.
    sessions_last_30_days: i64,
    visitors_last_30_days: i64,
    /// The open room, if there is one.
    room: Option<crate::room::RoomStats>,
    recent_activity: Vec<super::logs::AuditLog>,
}

async fn detail(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<BoardDetail>, ApiError> {
    let board = find(&state, id).await?;
    let (schema_version, snapshot_at, pending_updates): (i32, Option<DateTime<Utc>>, i64) = sqlx::query_as(
        "SELECT b.schema_version, s.created_at, (SELECT count(*) FROM board_updates u WHERE u.board_id = b.id)
         FROM boards b LEFT JOIN board_snapshots s ON s.board_id = b.id WHERE b.id = $1",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    let (sessions, visitors): (i64, i64) = sqlx::query_as(
        "SELECT count(*), count(DISTINCT visitor_id) FROM connections
         WHERE board_id = $1 AND started_at >= now() - interval '30 days'",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    let recent_activity = sqlx::query_as(
        "SELECT id, actor, actor_id, action, resource, metadata, ip, created_at FROM audit_logs
         WHERE resource = $1 ORDER BY created_at DESC, id DESC LIMIT 20",
    )
    .bind(format!("board:{id}"))
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(BoardDetail {
        board,
        schema_version,
        snapshot_at,
        pending_updates,
        links: load_links(&state.pool, id).await?,
        sessions_last_30_days: sessions,
        visitors_last_30_days: visitors,
        room: state.rooms.stats(id).await,
        recent_activity,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateBody {
    /// The new owner's id, or null for no owner. The title lives in the board itself, so it's
    /// changed in the editor, not here.
    #[serde(default)]
    owner_id: Option<Option<Uuid>>,
    /// Lock or unlock the board, like the editor's read-only switch.
    locked: Option<bool>,
}

async fn update(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateBody>,
) -> Result<Json<Board>, ApiError> {
    find(&state, id).await?;
    if let Some(owner_id) = body.owner_id {
        if let Some(owner) = owner_id {
            crate::accounts::user_by_id(&state.pool, owner)
                .await?
                .ok_or_else(|| ApiError::BadRequest("no user has that id".into()))?;
        }
        sqlx::query("UPDATE boards SET owner_id = $2 WHERE id = $1")
            .bind(id)
            .bind(owner_id)
            .execute(&state.pool)
            .await?;
        let metadata = json!({ "ownerId": owner_id });
        audit::record(
            &state.pool,
            &admin,
            "board.owner_changed",
            format!("board:{id}"),
            metadata,
            Some(&meta),
        )
        .await;
    }
    if let Some(locked) = body.locked {
        crate::db::set_locked(&state.pool, id, locked).await?;
        state.rooms.set_locked(id, locked).await;
        let action = if locked { "board.locked" } else { "board.unlocked" };
        audit::record(&state.pool, &admin, action, format!("board:{id}"), json!({}), Some(&meta)).await;
    }
    Ok(Json(find(&state, id).await?))
}

/// Archives or restores a board. Everyone is disconnected so they rejoin with the new access.
async fn set_archived(
    state: &AppState,
    admin: &User,
    meta: &RequestMeta,
    id: Uuid,
    archived: bool,
) -> Result<bool, ApiError> {
    let changed = sqlx::query(
        "UPDATE boards SET archived_at = CASE WHEN $2 THEN now() END
         WHERE id = $1 AND (archived_at IS NOT NULL) <> $2",
    )
    .bind(id)
    .bind(archived)
    .execute(&state.pool)
    .await?
    .rows_affected()
        == 1;
    if changed {
        state.rooms.disconnect_all(id).await;
        let action = if archived { "board.archived" } else { "board.unarchived" };
        audit::record(&state.pool, admin, action, format!("board:{id}"), json!({}), Some(meta)).await;
    }
    Ok(changed)
}

async fn archive(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
) -> Result<Json<Board>, ApiError> {
    find(&state, id).await?;
    set_archived(&state, &admin, &meta, id, true).await?;
    Ok(Json(find(&state, id).await?))
}

async fn unarchive(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
) -> Result<Json<Board>, ApiError> {
    find(&state, id).await?;
    set_archived(&state, &admin, &meta, id, false).await?;
    Ok(Json(find(&state, id).await?))
}

/// Deletes a board for good, with its history, links and images.
async fn delete_board(
    state: &AppState,
    admin: &User,
    meta: &RequestMeta,
    id: Uuid,
) -> Result<bool, ApiError> {
    // Close the room first so it saves before the rows go, not after.
    state.rooms.close_and_wait(id).await;
    let title: Option<String> = sqlx::query_scalar("DELETE FROM boards WHERE id = $1 RETURNING title")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let Some(title) = title else { return Ok(false) };
    audit::record(
        &state.pool,
        admin,
        "board.deleted",
        format!("board:{id}"),
        json!({ "title": title }),
        Some(meta),
    )
    .await;
    Ok(true)
}

async fn remove(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    if !delete_board(&state, &admin, &meta, id).await? {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum BulkAction {
    Archive,
    Unarchive,
    Delete,
}

#[derive(Deserialize)]
struct BulkBody {
    ids: Vec<Uuid>,
    action: BulkAction,
}

#[derive(Serialize)]
struct BulkResult {
    /// Boards that changed. Ones already in the asked-for state, or missing, are left out.
    updated: Vec<Uuid>,
}

async fn bulk(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Json(body): Json<BulkBody>,
) -> Result<Json<BulkResult>, ApiError> {
    if body.ids.len() > 500 {
        return Err(ApiError::BadRequest("at most 500 boards at a time".into()));
    }
    let mut updated = Vec::new();
    for id in body.ids {
        let changed = match body.action {
            BulkAction::Archive => set_archived(&state, &admin, &meta, id, true).await?,
            BulkAction::Unarchive => set_archived(&state, &admin, &meta, id, false).await?,
            BulkAction::Delete => delete_board(&state, &admin, &meta, id).await?,
        };
        if changed {
            updated.push(id);
        }
    }
    Ok(Json(BulkResult { updated }))
}

async fn tokens(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<ShareLink>>, ApiError> {
    find(&state, id).await?;
    Ok(Json(load_links(&state.pool, id).await?))
}

#[derive(Deserialize)]
struct NewLink {
    role: Role,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedLink {
    id: String,
    /// Shown once; only its hash is stored.
    token: String,
    role: Role,
}

/// Makes a new share link, e.g. for an admin to look at a board.
async fn create_token(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
    Json(body): Json<NewLink>,
) -> Result<(StatusCode, Json<CreatedLink>), ApiError> {
    find(&state, id).await?;
    let (token, hash) = new_token();
    db::add_token(&state.pool, id, &hash, body.role).await?;
    sqlx::query("UPDATE share_tokens SET created_by = $2 WHERE token_hash = $1")
        .bind(hash.as_slice())
        .bind(admin.id)
        .execute(&state.pool)
        .await?;
    let metadata = json!({ "role": body.role, "link": hex(&hash) });
    audit::record(&state.pool, &admin, "board.link_created", format!("board:{id}"), metadata, Some(&meta))
        .await;
    Ok((StatusCode::CREATED, Json(CreatedLink { id: hex(&hash), token, role: body.role })))
}

/// Revokes one link. Everyone is disconnected; those with another working link rejoin.
async fn revoke_token(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path((id, token_id)): Path<(Uuid, String)>,
) -> Result<StatusCode, ApiError> {
    let hash = unhex(&token_id).ok_or(ApiError::NotFound)?;
    let deleted = sqlx::query("DELETE FROM share_tokens WHERE token_hash = $1 AND board_id = $2")
        .bind(hash.as_slice())
        .bind(id)
        .execute(&state.pool)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound);
    }
    state.rooms.disconnect_all(id).await;
    let metadata = json!({ "link": token_id });
    audit::record(&state.pool, &admin, "board.link_revoked", format!("board:{id}"), metadata, Some(&meta))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct Asset {
    id: String,
    board_id: Uuid,
    board_title: String,
    mime: String,
    size: i32,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetParams {
    page: Option<i64>,
    limit: Option<i64>,
    board_id: Option<Uuid>,
    /// Comma-separated MIME types.
    mime: Option<String>,
    /// size or createdAt (default).
    sort: Option<String>,
    order: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetPage {
    #[serde(flatten)]
    page: Page<Asset>,
    /// Bytes across every asset matching the filter.
    total_bytes: i64,
}

async fn assets(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(p): Query<AssetParams>,
) -> Result<Json<AssetPage>, ApiError> {
    let (page, limit, offset) = paging(p.page, p.limit);
    let sort = match p.sort.as_deref() {
        Some("size") => "a.size",
        _ => "a.created_at",
    };
    let filter = "WHERE ($1::uuid IS NULL OR a.board_id = $1) AND ($2::text[] IS NULL OR a.mime = ANY($2))";
    let mimes = list_param(p.mime.as_deref());
    let (total, total_bytes): (i64, i64) = sqlx::query_as(crate::db::audited(format!(
        "SELECT count(*), COALESCE(sum(a.size), 0)::bigint FROM assets a {filter}"
    )))
    .bind(p.board_id)
    .bind(&mimes)
    .fetch_one(&state.pool)
    .await?;
    let data: Vec<Asset> = sqlx::query_as(crate::db::audited(format!(
        "SELECT encode(a.id, 'hex') AS id, a.board_id, b.title AS board_title, a.mime, a.size, a.created_at
         FROM assets a JOIN boards b ON b.id = a.board_id {filter}
         ORDER BY {sort} {}, a.id LIMIT $3 OFFSET $4",
        order(p.order.as_deref())
    )))
    .bind(p.board_id)
    .bind(&mimes)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(AssetPage { page: Page { data, total, page, limit }, total_bytes }))
}

async fn delete_asset(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(asset_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = unhex(&asset_id).ok_or(ApiError::NotFound)?;
    let board: Option<Uuid> = sqlx::query_scalar("DELETE FROM assets WHERE id = $1 RETURNING board_id")
        .bind(id.as_slice())
        .fetch_optional(&state.pool)
        .await?;
    let board = board.ok_or(ApiError::NotFound)?;
    let metadata = json!({ "asset": asset_id, "board": board });
    audit::record(&state.pool, &admin, "asset.deleted", format!("asset:{asset_id}"), metadata, Some(&meta))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

/// Assets younger than this are never orphans: the shape using one may not be saved yet.
const ORPHAN_GRACE: &str = "1 hour";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Orphans {
    assets: Vec<Asset>,
    total_bytes: i64,
    boards_scanned: usize,
}

/// Asset ids that any board's image shapes point at. A shape can show an image uploaded to
/// another board (copy and paste between boards), so every board is scanned.
async fn referenced_assets(pool: &PgPool) -> Result<(HashSet<String>, usize), ApiError> {
    let boards: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM boards").fetch_all(pool).await?;
    let mut referenced = HashSet::new();
    for &board in &boards {
        let stored = db::load_doc(pool, board).await?;
        let ids = tokio::task::spawn_blocking(move || asset_ids_in(&stored))
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        referenced.extend(ids);
    }
    Ok((referenced, boards.len()))
}

fn asset_ids_in(stored: &db::StoredDoc) -> HashSet<String> {
    let doc = Doc::new();
    {
        let mut txn = doc.transact_mut();
        for bytes in stored.snapshot.iter().chain(&stored.updates) {
            if let Ok(update) = Update::decode_v1(bytes) {
                let _ = txn.apply_update(update);
            }
        }
    }
    let txn = doc.transact();
    let mut ids = HashSet::new();
    if let Some(shapes) = txn.get_map("shapes") {
        collect_asset_ids(&shapes.to_json(&txn), &mut ids);
    }
    ids
}

/// Every string under an `assetId` key, at any depth (image shapes keep it in `props`).
fn collect_asset_ids(value: &Any, out: &mut HashSet<String>) {
    match value {
        Any::Map(map) => {
            for (key, value) in map.iter() {
                match value {
                    Any::String(id) if key == "assetId" => {
                        out.insert(id.to_string());
                    }
                    other => collect_asset_ids(other, out),
                }
            }
        }
        Any::Array(items) => items.iter().for_each(|v| collect_asset_ids(v, out)),
        _ => {}
    }
}

async fn find_orphans(pool: &PgPool) -> Result<(Vec<Asset>, usize), ApiError> {
    let (referenced, scanned) = referenced_assets(pool).await?;
    let candidates: Vec<Asset> = sqlx::query_as(crate::db::audited(format!(
        "SELECT encode(a.id, 'hex') AS id, a.board_id, b.title AS board_title, a.mime, a.size, a.created_at
         FROM assets a JOIN boards b ON b.id = a.board_id
         WHERE a.created_at < now() - interval '{ORPHAN_GRACE}' ORDER BY a.size DESC"
    )))
    .fetch_all(pool)
    .await?;
    Ok((candidates.into_iter().filter(|a| !referenced.contains(&a.id)).collect(), scanned))
}

/// Lists images no board uses. Loads every board, so it can take a while on a big server.
async fn orphans(State(state): State<AppState>, _admin: AdminUser) -> Result<Json<Orphans>, ApiError> {
    let (assets, boards_scanned) = find_orphans(&state.pool).await?;
    let total_bytes = assets.iter().map(|a| a.size as i64).sum();
    Ok(Json(Orphans { assets, total_bytes, boards_scanned }))
}

/// Deletes images no board uses, and returns what was deleted.
async fn delete_orphans(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
) -> Result<Json<Orphans>, ApiError> {
    let (assets, boards_scanned) = find_orphans(&state.pool).await?;
    let ids: Vec<Vec<u8>> = assets.iter().filter_map(|a| unhex(&a.id)).map(|id| id.to_vec()).collect();
    sqlx::query("DELETE FROM assets WHERE id = ANY($1)").bind(&ids).execute(&state.pool).await?;
    let total_bytes = assets.iter().map(|a| a.size as i64).sum();
    let metadata = json!({ "count": assets.len(), "bytes": total_bytes });
    audit::record(&state.pool, &admin, "asset.orphans_deleted", "assets", metadata, Some(&meta)).await;
    Ok(Json(Orphans { assets, total_bytes, boards_scanned }))
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Arc};

    use super::*;

    #[test]
    fn finds_asset_ids_at_any_depth() {
        let props: HashMap<String, Any> = [("assetId".to_owned(), Any::from("abc"))].into();
        let shape: HashMap<String, Any> =
            [("type".to_owned(), Any::from("image")), ("props".to_owned(), Any::Map(Arc::new(props)))].into();
        let shapes: HashMap<String, Any> = [("s1".to_owned(), Any::Map(Arc::new(shape)))].into();
        let mut ids = HashSet::new();
        collect_asset_ids(&Any::Map(Arc::new(shapes)), &mut ids);
        assert_eq!(ids, HashSet::from(["abc".to_owned()]));
    }
}
