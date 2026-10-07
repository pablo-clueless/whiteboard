use std::time::{Duration, Instant};

use axum::{
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{
    AppState,
    auth::hash_token,
    db,
    room::{ConnId, OUTGOING_QUEUE, Role},
};

/// Max size of one incoming WebSocket message.
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

/// Per-connection message rate limit (token bucket). A drag sends at most ~60 updates/s plus
/// cursor updates, so this leaves plenty of headroom. Over the limit we stop reading for a moment
/// rather than disconnect: TCP backpressure slows the sender, and nothing is lost.
const RATE_PER_SEC: f64 = 200.0;
const RATE_BURST: f64 = 400.0;

/// Close codes in 4400–4499 tell y-websocket not to reconnect.
const CLOSE_INVALID_LINK: u16 = 4403;
const CLOSE_NO_BOARD: u16 = 4404;
const CLOSE_SERVER_ERROR: u16 = 1011;

#[derive(Deserialize)]
pub struct WsParams {
    token: Option<String>,
}

pub async fn upgrade(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    Query(params): Query<WsParams>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // Reject cross-site WebSocket hijacking: browsers always send Origin on upgrades.
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    if !origin.is_some_and(|o| state.config.is_origin_allowed(o)) {
        tracing::warn!(?origin, %board_id, "rejected websocket: origin not allowed");
        return StatusCode::FORBIDDEN.into_response();
    }

    // An HTTP error here would make the client retry forever. Upgrade, then close with a code
    // it treats as permanent.
    let access = resolve(&state, board_id, params.token.as_deref()).await;
    ws.max_message_size(MAX_MESSAGE_BYTES).on_upgrade(move |socket| async move {
        match access {
            Ok(role) => handle_socket(socket, state, board_id, role).await,
            Err((code, reason)) => close(socket, code, reason).await,
        }
    })
}

/// The role the token grants, or the close code and reason to send instead.
async fn resolve(state: &AppState, board_id: Uuid, token: Option<&str>) -> Result<Role, (u16, &'static str)> {
    let lookup = async {
        if let Some(token) = token
            && let Some(role) = db::token_role(&state.pool, board_id, &hash_token(token)).await?
        {
            return Ok(Ok(role));
        }
        // Tell a bad link apart from a missing board, for a clearer message.
        Ok::<_, sqlx::Error>(Err(match db::board(&state.pool, board_id).await? {
            Some(_) => (CLOSE_INVALID_LINK, "This link doesn't give access to the board"),
            None => (CLOSE_NO_BOARD, "Board not found"),
        }))
    };
    lookup.await.unwrap_or_else(|err| {
        tracing::error!(%board_id, %err, "access lookup failed");
        Err((CLOSE_SERVER_ERROR, "Server error"))
    })
}

/// Closes with `code` and waits briefly for the client's reply. Dropping the TCP connection right
/// after our close frame can race with the client's first message: it then sees a reset, reports
/// 1006 instead of our code, and retries.
async fn close(mut socket: WebSocket, code: u16, reason: &'static str) {
    if socket.send(Message::Close(Some(CloseFrame { code, reason: reason.into() }))).await.is_err() {
        return;
    }
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        while let Some(Ok(msg)) = socket.recv().await {
            if matches!(msg, Message::Close(_)) {
                break;
            }
        }
    })
    .await;
}

async fn handle_socket(socket: WebSocket, state: AppState, board_id: Uuid, role: Role) {
    let conn = ConnId::new();
    let (out_tx, mut out_rx) = mpsc::channel::<Bytes>(OUTGOING_QUEUE);

    let Some(room) = state.rooms.join(board_id, conn, role, out_tx).await else {
        tracing::error!(%board_id, "failed to join room");
        return close(socket, CLOSE_SERVER_ERROR, "Server error").await;
    };
    tracing::debug!(%board_id, %conn, ?role, "client connected");

    let (mut sink, mut stream) = socket.split();

    // The room drops our sender when it evicts us, which ends this task.
    let mut writer = tokio::spawn(async move {
        while let Some(bytes) = out_rx.recv().await {
            if sink.send(Message::Binary(bytes)).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let reader_room = room.clone();
    let mut reader = tokio::spawn(async move {
        let mut bucket = RATE_BURST;
        let mut last = Instant::now();
        while let Some(Ok(msg)) = stream.next().await {
            let now = Instant::now();
            bucket = (bucket + now.duration_since(last).as_secs_f64() * RATE_PER_SEC).min(RATE_BURST);
            last = now;
            if bucket < 1.0 {
                let wait = Duration::from_secs_f64((1.0 - bucket) / RATE_PER_SEC);
                tokio::time::sleep(wait).await;
                bucket = 1.0;
                last = Instant::now();
            }
            bucket -= 1.0;
            match msg {
                Message::Binary(bytes) => {
                    if !reader_room.message(conn, bytes).await {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Either side ending tears the connection down.
    tokio::select! {
        _ = &mut writer => reader.abort(),
        _ = &mut reader => writer.abort(),
    }

    room.leave(conn).await;
    tracing::debug!(%board_id, %conn, "client disconnected");
}
