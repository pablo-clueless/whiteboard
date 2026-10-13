//! One actor per open board. Connections talk to it through a [`RoomHandle`].

mod actor;
mod persist;

use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};

use bytes::Bytes;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::Serialize;
use sqlx::PgPool;
use tokio::sync::{mpsc, oneshot, watch};
use uuid::Uuid;

pub use crate::auth::Role;
use crate::settings::SettingsStore;

pub type BoardId = Uuid;

/// Per-client outgoing queue length. A client that falls this far behind is disconnected.
pub const OUTGOING_QUEUE: usize = 256;

/// Inbox length of a room actor.
const ROOM_INBOX: usize = 1024;

/// How long an admin request waits for a busy room to report.
const STATS_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ConnId(u64);

impl ConnId {
    pub fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        Self(NEXT.fetch_add(1, Ordering::Relaxed))
    }

    /// Parses the `c<n>` form that Display writes.
    pub fn parse(s: &str) -> Option<Self> {
        s.strip_prefix('c')?.parse().ok().map(Self)
    }
}

impl fmt::Display for ConnId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "c{}", self.0)
    }
}

impl Serialize for ConnId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

/// Who a connection is, for the admin interface.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub user_id: Option<Uuid>,
    pub user_name: Option<String>,
    pub browser: &'static str,
    pub device: &'static str,
    pub connected_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStats {
    pub id: ConnId,
    pub role: Role,
    #[serde(flatten)]
    pub info: ClientInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomStats {
    pub board_id: BoardId,
    pub opened_at: DateTime<Utc>,
    pub clients: Vec<ClientStats>,
    pub editors: usize,
    pub viewers: usize,
    /// Locked read-only by an editor, and the lock is in force.
    pub locked: bool,
    /// Edits applied in the last minute.
    pub updates_last_minute: usize,
    pub updates_since_snapshot: usize,
    /// Approximate encoded size of the board.
    pub doc_bytes: usize,
    pub max_doc_bytes: usize,
    pub full: bool,
    pub last_snapshot_at: Option<DateTime<Utc>>,
}

pub(crate) enum RoomMsg {
    Join {
        conn: ConnId,
        role: Role,
        info: ClientInfo,
        tx: mpsc::Sender<Bytes>,
    },
    Message {
        conn: ConnId,
        data: Bytes,
    },
    Leave {
        conn: ConnId,
    },
    /// Disconnect everyone, e.g. after share links are rotated. They must reconnect with a valid
    /// token.
    DisconnectAll,
    /// Disconnect one connection. y-websocket reconnects on its own, so this only sticks once its
    /// link no longer works.
    Kick {
        conn: ConnId,
        reply: oneshot::Sender<bool>,
    },
    Stats {
        reply: oneshot::Sender<RoomStats>,
    },
    /// Disconnect everyone, save, and shut the room down now.
    Close,
    /// An editor locked or unlocked the board (already saved).
    SetLocked(bool),
    /// Board settings changed: re-tell everyone whether the board is locked, since the lock only
    /// counts while the read-only switch is on.
    SettingsChanged,
}

#[derive(Clone)]
pub struct RoomHandle {
    tx: mpsc::Sender<RoomMsg>,
    /// Connected clients, kept up to date by the actor so counting needs no round trip.
    clients: Arc<AtomicUsize>,
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
    /// Size limit and idle timeout, read live so admin changes apply to open rooms.
    settings: SettingsStore,
    /// Ticks whenever a room opens or closes or someone joins or leaves, for the live admin page.
    changed: Arc<watch::Sender<()>>,
}

impl RoomRegistry {
    pub fn new(pool: PgPool, settings: SettingsStore) -> Self {
        Self { rooms: Arc::default(), pool, settings, changed: Arc::new(watch::channel(()).0) }
    }

    /// Wakes when the set of rooms or connections changes.
    pub fn subscribe(&self) -> watch::Receiver<()> {
        self.changed.subscribe()
    }

    fn notify_changed(&self) {
        self.changed.send_replace(());
    }

    /// Joins the board's room, starting its actor (and loading the board) if it isn't running.
    pub async fn join(
        &self,
        board_id: BoardId,
        conn: ConnId,
        role: Role,
        info: ClientInfo,
        tx: mpsc::Sender<Bytes>,
    ) -> Option<RoomHandle> {
        // A room can shut down between lookup and send; retry against a fresh actor.
        for _ in 0..3 {
            let handle = self.rooms.entry(board_id).or_insert_with(|| self.spawn(board_id)).clone();
            let join = RoomMsg::Join { conn, role, info: info.clone(), tx: tx.clone() };
            if handle.tx.send(join).await.is_ok() {
                return Some(handle);
            }
            self.remove_closed(board_id);
        }
        None
    }

    /// Disconnects everyone in the board's room, if it's open.
    pub async fn disconnect_all(&self, board_id: BoardId) {
        if let Some(handle) = self.handle(board_id) {
            let _ = handle.tx.send(RoomMsg::DisconnectAll).await;
        }
    }

    /// Shuts the board's room down, if it's open. Returns whether it was.
    pub async fn close(&self, board_id: BoardId) -> bool {
        match self.handle(board_id) {
            Some(handle) => handle.tx.send(RoomMsg::Close).await.is_ok(),
            None => false,
        }
    }

    /// Tells the board's room it was locked or unlocked, if it's open.
    pub async fn set_locked(&self, board_id: BoardId, locked: bool) {
        if let Some(handle) = self.handle(board_id) {
            let _ = handle.tx.send(RoomMsg::SetLocked(locked)).await;
        }
    }

    /// Tells every open room the board settings changed.
    pub async fn settings_changed(&self) {
        let handles: Vec<RoomHandle> = self.rooms.iter().map(|h| h.clone()).collect();
        for handle in handles {
            let _ = handle.tx.send(RoomMsg::SettingsChanged).await;
        }
    }

    /// Disconnects one connection. Returns whether it was connected.
    pub async fn kick(&self, board_id: BoardId, conn: ConnId) -> bool {
        let Some(handle) = self.handle(board_id) else {
            return false;
        };
        let (reply, rx) = oneshot::channel();
        if handle.tx.send(RoomMsg::Kick { conn, reply }).await.is_err() {
            return false;
        }
        tokio::time::timeout(STATS_TIMEOUT, rx).await.ok().and_then(Result::ok).unwrap_or(false)
    }

    /// Shuts the board's room down and waits (briefly) until it has saved and gone.
    pub async fn close_and_wait(&self, board_id: BoardId) {
        if !self.close(board_id).await {
            return;
        }
        for _ in 0..60 {
            if !self.rooms.contains_key(&board_id) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        tracing::warn!(%board_id, "room didn't close in time");
    }

    pub fn open_rooms(&self) -> usize {
        self.rooms.len()
    }

    /// Connected clients on a board, without asking its actor.
    pub fn client_count(&self, board_id: BoardId) -> usize {
        self.rooms.get(&board_id).map_or(0, |h| h.clients.load(Ordering::Relaxed))
    }

    pub fn total_clients(&self) -> usize {
        self.rooms.iter().map(|h| h.clients.load(Ordering::Relaxed)).sum()
    }

    /// Live stats for one board's room, or None if it isn't open (or didn't answer in time).
    pub async fn stats(&self, board_id: BoardId) -> Option<RoomStats> {
        let handle = self.handle(board_id)?;
        let (reply, rx) = oneshot::channel();
        handle.tx.send(RoomMsg::Stats { reply }).await.ok()?;
        tokio::time::timeout(STATS_TIMEOUT, rx).await.ok()?.ok()
    }

    /// Live stats for every open room, asked in parallel.
    pub async fn all_stats(&self) -> Vec<RoomStats> {
        let ids: Vec<BoardId> = self.rooms.iter().map(|e| *e.key()).collect();
        let mut stats: Vec<RoomStats> =
            futures_util::future::join_all(ids.into_iter().map(|id| self.stats(id)))
                .await
                .into_iter()
                .flatten()
                .collect();
        stats.sort_by_key(|s| std::cmp::Reverse(s.clients.len()));
        stats
    }

    fn handle(&self, board_id: BoardId) -> Option<RoomHandle> {
        self.rooms.get(&board_id).map(|h| h.clone())
    }

    fn spawn(&self, board_id: BoardId) -> RoomHandle {
        let (tx, rx) = mpsc::channel(ROOM_INBOX);
        let clients = Arc::new(AtomicUsize::new(0));
        tokio::spawn(actor::run(board_id, rx, self.clone(), clients.clone()));
        RoomHandle { tx, clients }
    }

    /// Removes the board's entry only if it points at a stopped actor.
    fn remove_closed(&self, board_id: BoardId) {
        self.rooms.remove_if(&board_id, |_, h| h.tx.is_closed());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conn_ids_round_trip() {
        let id = ConnId::new();
        assert_eq!(ConnId::parse(&id.to_string()), Some(id));
        assert_eq!(ConnId::parse("x1"), None);
        assert_eq!(ConnId::parse("c"), None);
    }
}
