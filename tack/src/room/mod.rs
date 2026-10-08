//! One actor per open board. Connections talk to it through a [`RoomHandle`].

mod actor;
mod persist;

use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use bytes::Bytes;
use dashmap::DashMap;
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

pub use crate::auth::Role;

pub type BoardId = Uuid;

/// Per-client outgoing queue length. A client that falls this far behind is disconnected.
pub const OUTGOING_QUEUE: usize = 256;

/// Inbox length of a room actor.
const ROOM_INBOX: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ConnId(u64);

impl ConnId {
    pub fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        Self(NEXT.fetch_add(1, Ordering::Relaxed))
    }
}

impl fmt::Display for ConnId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "c{}", self.0)
    }
}

pub(crate) enum RoomMsg {
    Join { conn: ConnId, role: Role, tx: mpsc::Sender<Bytes> },
    Message { conn: ConnId, data: Bytes },
    Leave { conn: ConnId },
    /// Disconnect everyone, e.g. after share links are rotated. They must reconnect with a valid
    /// token.
    DisconnectAll,
}

#[derive(Clone)]
pub struct RoomHandle {
    tx: mpsc::Sender<RoomMsg>,
}

impl RoomHandle {
    /// Forwards a raw y-protocol message. Returns false if the room is gone.
    pub async fn message(&self, conn: ConnId, data: Bytes) -> bool {
        self.tx.send(RoomMsg::Message { conn, data }).await.is_ok()
    }

    pub async fn leave(&self, conn: ConnId) {
        let _ = self.tx.send(RoomMsg::Leave { conn }).await;
    }
}

#[derive(Clone)]
pub struct RoomRegistry {
    rooms: Arc<DashMap<BoardId, RoomHandle>>,
    pool: PgPool,
    /// Boards stop accepting edits past roughly this size (encoded state plus updates since).
    max_doc_bytes: usize,
}

impl RoomRegistry {
    pub fn new(pool: PgPool, max_doc_bytes: usize) -> Self {
        Self { rooms: Arc::default(), pool, max_doc_bytes }
    }

    /// Joins the board's room, starting its actor (and loading the board) if it isn't running.
    pub async fn join(
        &self,
        board_id: BoardId,
        conn: ConnId,
        role: Role,
        tx: mpsc::Sender<Bytes>,
    ) -> Option<RoomHandle> {
        // A room can shut down between lookup and send; retry against a fresh actor.
        for _ in 0..3 {
            let handle = self
                .rooms
                .entry(board_id)
                .or_insert_with(|| self.spawn(board_id))
                .clone();
            if handle.tx.send(RoomMsg::Join { conn, role, tx: tx.clone() }).await.is_ok() {
                return Some(handle);
            }
            self.remove_closed(board_id);
        }
        None
    }

    /// Disconnects everyone in the board's room, if it's open.
    pub async fn disconnect_all(&self, board_id: BoardId) {
        let handle = self.rooms.get(&board_id).map(|h| h.clone());
        if let Some(handle) = handle {
            let _ = handle.tx.send(RoomMsg::DisconnectAll).await;
        }
    }

    fn spawn(&self, board_id: BoardId) -> RoomHandle {
        let (tx, rx) = mpsc::channel(ROOM_INBOX);
        tokio::spawn(actor::run(board_id, rx, self.clone()));
        RoomHandle { tx }
    }

    /// Removes the board's entry only if it points at a stopped actor.
    fn remove_closed(&self, board_id: BoardId) {
        self.rooms.remove_if(&board_id, |_, h| h.tx.is_closed());
    }
}
