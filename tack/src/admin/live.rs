//! The live page: open rooms and who's connected right now, with controls to disconnect people
//! and close rooms.

use std::{collections::HashMap, convert::Infallible, time::Duration};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event, KeepAlive, Sse},
    routing::{delete, get, post},
};
use chrono::{DateTime, Utc};
use futures_util::Stream;
use serde::Serialize;
use serde_json::json;
use tokio::{sync::watch, time::Instant};
use uuid::Uuid;

use crate::{
    AppState,
    accounts::{self, AdminUser},
    api::ApiError,
    audit,
    request_meta::RequestMeta,
    room::{ClientStats, ConnId, RoomStats},
};

/// How often the stream looks at the rooms when nobody joined or left, for edit rates and sizes.
const STREAM_TICK: Duration = Duration::from_secs(2);
/// Joins and leaves come in bursts (a reload is both), so wait this long and send one update.
const STREAM_DEBOUNCE: Duration = Duration::from_millis(200);
/// How often the stream re-checks the admin's session, so signing out or a revoked session ends it.
const STREAM_REAUTH: Duration = Duration::from_secs(60);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/live", get(live))
        .route("/api/admin/live/stream", get(stream))
        .route("/api/admin/live/rooms/{board_id}", get(room))
        .route("/api/admin/live/rooms/{board_id}/close", post(close_room))
        .route("/api/admin/live/rooms/{board_id}/disconnect", post(disconnect_all))
        .route("/api/admin/live/rooms/{board_id}/connections/{conn_id}", delete(kick))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoom {
    pub title: String,
    #[serde(flatten)]
    pub stats: RoomStats,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveConnection {
    board_id: Uuid,
    board_title: String,
    #[serde(flatten)]
    client: ClientStats,
}

#[derive(Clone, Serialize, sqlx::FromRow)]
struct TimelinePoint {
    time: DateTime<Utc>,
    connections: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Live {
    open_rooms: usize,
    connected_clients: usize,
    editors: usize,
    viewers: usize,
    /// Signed-in people connected, counted once however many boards they have open.
    signed_in_users: usize,
    updates_last_minute: usize,
    by_browser: HashMap<&'static str, usize>,
    by_device: HashMap<&'static str, usize>,
    rooms: Vec<LiveRoom>,
    connections: Vec<LiveConnection>,
    /// Connections open at each minute of the last hour.
    timeline: Vec<TimelinePoint>,
}

/// Board titles by id, for labelling rooms.
async fn titles(state: &AppState, ids: Vec<Uuid>) -> Result<HashMap<Uuid, String>, ApiError> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as("SELECT id, title FROM boards WHERE id = ANY($1)")
        .bind(ids)
        .fetch_all(&state.pool)
        .await?;
    Ok(rows.into_iter().collect())
}

async fn live(State(state): State<AppState>, _admin: AdminUser) -> Result<Json<Live>, ApiError> {
    let timeline = timeline(&state).await?;
    Ok(Json(snapshot(&state, timeline).await?))
}

/// The live page as server-sent events: a `live` event with the body `GET /api/admin/live` would
/// return, straight away and then whenever it changes. Joins and leaves arrive within
/// STREAM_DEBOUNCE; edit rates within STREAM_TICK.
async fn stream(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let token = accounts::bearer(&headers).ok_or(ApiError::Unauthorized)?.to_owned();
    let live = LiveStream {
        changes: state.rooms.subscribe(),
        state,
        token,
        last: None,
        timeline: None,
        checked_at: Instant::now(),
        first: true,
    };
    let events = futures_util::stream::unfold(live, |mut live| async move {
        live.next().await.map(|event| (Ok(event), live))
    });
    Ok(Sse::new(events).keep_alive(KeepAlive::default()))
}

struct LiveStream {
    state: AppState,
    /// The admin's session token, re-checked every STREAM_REAUTH.
    token: String,
    changes: watch::Receiver<()>,
    /// The last body sent, so an unchanged one isn't sent again.
    last: Option<String>,
    /// The timeline and the minute it was read in. It only moves once a minute, or when someone
    /// joins or leaves.
    timeline: Option<(i64, Vec<TimelinePoint>)>,
    checked_at: Instant,
    first: bool,
}

impl LiveStream {
    /// The next event to send, or None to end the stream.
    async fn next(&mut self) -> Option<Event> {
        loop {
            let mut joined_or_left = self.first;
            if !self.first {
                tokio::select! {
                    changed = self.changes.changed() => {
                        // Err only once the registry is gone, which it never is while serving.
                        if changed.is_ok() {
                            tokio::time::sleep(STREAM_DEBOUNCE).await;
                            self.changes.borrow_and_update();
                            joined_or_left = true;
                        } else {
                            tokio::time::sleep(STREAM_TICK).await;
                        }
                    }
                    _ = tokio::time::sleep(STREAM_TICK) => {}
                }
            }
            self.first = false;

            if self.checked_at.elapsed() >= STREAM_REAUTH {
                self.checked_at = Instant::now();
                if !self.still_admin().await {
                    return None;
                }
            }
            match self.body(joined_or_left).await {
                Ok(body) if self.last.as_ref() != Some(&body) => {
                    self.last = Some(body.clone());
                    return Some(Event::default().event("live").data(body));
                }
                Ok(_) => {}
                Err(err) => tracing::warn!(?err, "live stream update failed"),
            }
        }
    }

    async fn still_admin(&self) -> bool {
        let timeout = self.state.settings.read(|s| s.security.session_timeout);
        match accounts::user_for_session(&self.state.pool, &self.token, timeout).await {
            Ok(Some((_, user))) => accounts::admin_access(&self.state, &user, accounts::ADMIN_READ).is_ok(),
            _ => false,
        }
    }

    async fn body(&mut self, refresh_timeline: bool) -> Result<String, ApiError> {
        let minute = Utc::now().timestamp() / 60;
        let timeline = match &self.timeline {
            Some((at, points)) if *at == minute && !refresh_timeline => points.clone(),
            _ => {
                let points = timeline(&self.state).await?;
                self.timeline = Some((minute, points.clone()));
                points
            }
        };
        let live = snapshot(&self.state, timeline).await?;
        serde_json::to_string(&live).map_err(|e| ApiError::Internal(e.to_string()))
    }
}

/// Connections open at each minute of the last hour.
async fn timeline(state: &AppState) -> Result<Vec<TimelinePoint>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT t AS time, count(c.id) AS connections
         FROM generate_series(date_trunc('minute', now()) - interval '59 minutes', date_trunc('minute', now()), interval '1 minute') t
         LEFT JOIN connections c ON c.started_at <= t + interval '1 minute' AND (c.ended_at IS NULL OR c.ended_at > t)
              AND c.started_at > now() - interval '1 day'
         GROUP BY t ORDER BY t",
    )
    .fetch_all(&state.pool)
    .await?)
}

async fn snapshot(state: &AppState, timeline: Vec<TimelinePoint>) -> Result<Live, ApiError> {
    let stats = state.rooms.all_stats().await;
    let titles = titles(state, stats.iter().map(|s| s.board_id).collect()).await?;

    let mut by_browser = HashMap::new();
    let mut by_device = HashMap::new();
    let mut users = std::collections::HashSet::new();
    let mut connections = Vec::new();
    for room in &stats {
        for client in &room.clients {
            *by_browser.entry(client.info.browser).or_insert(0) += 1;
            *by_device.entry(client.info.device).or_insert(0) += 1;
            users.extend(client.info.user_id);
            connections.push(LiveConnection {
                board_id: room.board_id,
                board_title: titles.get(&room.board_id).cloned().unwrap_or_default(),
                client: client.clone(),
            });
        }
    }
    connections.sort_by_key(|c| std::cmp::Reverse(c.client.info.connected_at));

    Ok(Live {
        open_rooms: stats.len(),
        connected_clients: connections.len(),
        editors: stats.iter().map(|s| s.editors).sum(),
        viewers: stats.iter().map(|s| s.viewers).sum(),
        signed_in_users: users.len(),
        updates_last_minute: stats.iter().map(|s| s.updates_last_minute).sum(),
        by_browser,
        by_device,
        rooms: stats
            .into_iter()
            .map(|stats| LiveRoom { title: titles.get(&stats.board_id).cloned().unwrap_or_default(), stats })
            .collect(),
        connections,
        timeline,
    })
}

async fn room(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(board_id): Path<Uuid>,
) -> Result<Json<LiveRoom>, ApiError> {
    let stats = state.rooms.stats(board_id).await.ok_or(ApiError::NotFound)?;
    let title = titles(&state, vec![board_id]).await?.remove(&board_id).unwrap_or_default();
    Ok(Json(LiveRoom { title, stats }))
}

/// Saves the board and shuts its room down. Anyone connected reconnects and reopens it.
async fn close_room(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(board_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    if !state.rooms.close(board_id).await {
        return Err(ApiError::NotFound);
    }
    audit::record(&state.pool, &admin, "room.closed", format!("board:{board_id}"), json!({}), Some(&meta))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

async fn disconnect_all(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(board_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let count = state.rooms.client_count(board_id);
    state.rooms.disconnect_all(board_id).await;
    let metadata = json!({ "connections": count });
    audit::record(
        &state.pool,
        &admin,
        "room.disconnected_all",
        format!("board:{board_id}"),
        metadata,
        Some(&meta),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

async fn kick(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path((board_id, conn_id)): Path<(Uuid, String)>,
) -> Result<StatusCode, ApiError> {
    let conn = ConnId::parse(&conn_id).ok_or(ApiError::NotFound)?;
    if !state.rooms.kick(board_id, conn).await {
        return Err(ApiError::NotFound);
    }
    let metadata = json!({ "connection": conn_id });
    audit::record(
        &state.pool,
        &admin,
        "room.disconnected",
        format!("board:{board_id}"),
        metadata,
        Some(&meta),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
