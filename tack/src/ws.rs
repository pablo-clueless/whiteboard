use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{
    AppState,
    room::{ConnId, OUTGOING_QUEUE, Role},
};

/// Max size of one incoming WebSocket message.
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

pub async fn upgrade(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // Reject cross-site WebSocket hijacking: browsers always send Origin on upgrades.
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    if !origin.is_some_and(|o| state.config.is_origin_allowed(o)) {
        tracing::warn!(?origin, %board_id, "rejected websocket: origin not allowed");
        return StatusCode::FORBIDDEN.into_response();
    }

    // TODO(M2): resolve role from the `token` query param against share_tokens.
    let role = Role::Edit;

    ws.max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, state, board_id, role))
}

async fn handle_socket(socket: WebSocket, state: AppState, board_id: Uuid, role: Role) {
    let conn = ConnId::new();
    let (out_tx, mut out_rx) = mpsc::channel::<Bytes>(OUTGOING_QUEUE);

    let Some(room) = state.rooms.join(board_id, conn, role, out_tx).await else {
        tracing::error!(%board_id, "failed to join room");
        return;
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
        while let Some(Ok(msg)) = stream.next().await {
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
