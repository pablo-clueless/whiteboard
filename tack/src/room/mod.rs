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

    /// A room end to end, through the registry, against the dev Postgres (skipped without it).
    /// Each client is a channel the room writes frames to, read the way y-websocket reads them:
    /// one message per frame.
    mod end_to_end {
        use yrs::{
            Doc, Map, ReadTxn, StateVector, Transact, Update,
            encoding::read::Cursor,
            sync::{Awareness, AwarenessUpdate, Message, MessageReader, SyncMessage},
            updates::{
                decoder::{Decode, DecoderV1},
                encoder::Encode,
            },
        };

        use super::*;
        use crate::{config::Config, room::persist::tests as db_test};

        struct Client {
            conn: ConnId,
            handle: RoomHandle,
            rx: mpsc::Receiver<Bytes>,
        }

        impl Client {
            async fn join(rooms: &RoomRegistry, board: BoardId, role: Role) -> Self {
                let (tx, rx) = mpsc::channel(OUTGOING_QUEUE);
                let conn = ConnId::new();
                let info = ClientInfo {
                    user_id: None,
                    user_name: None,
                    browser: "Test",
                    device: "Desktop",
                    connected_at: Utc::now(),
                };
                let handle = rooms.join(board, conn, role, info, tx).await.expect("room open");
                Self { conn, handle, rx }
            }

            async fn send(&self, msg: Message) {
                assert!(self.handle.message(self.conn, msg.encode_v1().into()).await);
            }

            /// The next frame, which must hold exactly one message.
            async fn next(&mut self) -> Message {
                let frame = tokio::time::timeout(Duration::from_secs(2), self.rx.recv())
                    .await
                    .expect("a message within 2 s")
                    .expect("connection open");
                let mut decoder = DecoderV1::new(Cursor::new(&frame));
                let mut messages: Vec<_> =
                    MessageReader::new(&mut decoder).map(|m| m.expect("decodable")).collect();
                assert_eq!(messages.len(), 1, "one message per frame, got {messages:?}");
                messages.remove(0)
            }

            /// Waits for a message matching `want`, skipping others (awareness, sync replies).
            async fn expect(&mut self, want: impl Fn(&Message) -> bool) -> Message {
                for _ in 0..20 {
                    let msg = self.next().await;
                    if want(&msg) {
                        return msg;
                    }
                }
                panic!("never got the expected message");
            }

            /// Nothing more arrives for a moment.
            async fn quiet(&mut self) -> Vec<Message> {
                let mut extra = Vec::new();
                while let Ok(Some(frame)) =
                    tokio::time::timeout(Duration::from_millis(300), self.rx.recv()).await
                {
                    let mut decoder = DecoderV1::new(Cursor::new(&frame));
                    extra.extend(MessageReader::new(&mut decoder).filter_map(Result::ok));
                }
                extra
            }

            async fn leave(self) {
                self.handle.leave(self.conn).await;
            }
        }

        async fn setup() -> Option<(sqlx::PgPool, RoomRegistry, BoardId)> {
            let pool = db_test::pool().await?;
            let config = Config {
                addr: "127.0.0.1:0".parse().unwrap(),
                allowed_origins: vec![],
                database_url: String::new(),
                max_board_bytes: 20 * 1024 * 1024,
                app_url: String::new(),
                trust_proxy: false,
                storage_quota_bytes: None,
                bootstrap_admin: None,
                smtp_url: None,
                mail_from: "test@localhost".into(),
            };
            let settings = SettingsStore::load(&pool, &config).await.unwrap();
            let board = db_test::new_board(&pool).await;
            Some((pool.clone(), RoomRegistry::new(pool, settings), board))
        }

        /// One edit from a client's own doc, as a sync update message.
        fn edit(doc: &Doc, key: &str) -> Message {
            let shapes = doc.get_or_insert_map("shapes");
            let before = doc.transact().state_vector();
            shapes.insert(&mut doc.transact_mut(), key, "rect");
            Message::Sync(SyncMessage::Update(doc.transact().encode_diff_v1(&before)))
        }

        fn awareness(doc: Doc, name: &str) -> Message {
            let mut awareness = Awareness::new(doc);
            awareness.set_local_state(serde_json::json!({ "user": { "name": name } })).unwrap();
            Message::Awareness(awareness.update().unwrap())
        }

        fn names(update: &AwarenessUpdate) -> Vec<String> {
            let mut names: Vec<String> = update
                .clients
                .values()
                .filter_map(|e| serde_json::from_str::<serde_json::Value>(&e.json).ok())
                .filter_map(|v| v["user"]["name"].as_str().map(str::to_owned))
                .collect();
            names.sort();
            names
        }

        /// The keys of `shapes` in an update, applied to an empty doc.
        fn shapes_in(update: &[u8]) -> Vec<String> {
            let doc = Doc::new();
            let shapes = doc.get_or_insert_map("shapes");
            doc.transact_mut().apply_update(Update::decode_v1(update).unwrap()).unwrap();
            let mut keys: Vec<String> = shapes.keys(&doc.transact()).map(str::to_owned).collect();
            keys.sort();
            keys
        }

        #[tokio::test]
        async fn edits_reach_everyone_else_and_viewers_cant_edit() {
            let Some((pool, rooms, board)) = setup().await else { return };
            let mut alice = Client::join(&rooms, board, Role::Edit).await;
            let mut bob = Client::join(&rooms, board, Role::Edit).await;
            let mut viewer = Client::join(&rooms, board, Role::View).await;
            // Each starts with the room's sync step 1, in its own frame.
            for c in [&mut alice, &mut bob, &mut viewer] {
                assert!(matches!(c.next().await, Message::Sync(SyncMessage::SyncStep1(_))));
            }

            let doc = Doc::new();
            alice.send(edit(&doc, "a")).await;
            for c in [&mut bob, &mut viewer] {
                let Message::Sync(SyncMessage::Update(u)) =
                    c.expect(|m| matches!(m, Message::Sync(SyncMessage::Update(_)))).await
                else {
                    unreachable!()
                };
                assert_eq!(shapes_in(&u), ["a"]);
            }
            // Not echoed to the sender.
            assert!(!alice.quiet().await.iter().any(|m| matches!(m, Message::Sync(_))));

            // A viewer's edit goes nowhere, and isn't in the room's copy.
            viewer.send(edit(&Doc::new(), "v")).await;
            assert!(!bob.quiet().await.iter().any(|m| matches!(m, Message::Sync(_))));
            viewer.send(Message::Sync(SyncMessage::SyncStep1(StateVector::default()))).await;
            let Message::Sync(SyncMessage::SyncStep2(state)) =
                viewer.expect(|m| matches!(m, Message::Sync(SyncMessage::SyncStep2(_)))).await
            else {
                unreachable!()
            };
            assert_eq!(shapes_in(&state), ["a"]);

            for c in [alice, bob, viewer] {
                c.leave().await;
            }
            rooms.close_and_wait(board).await;
            db_test::delete_board(&pool, board).await;
        }

        #[tokio::test]
        async fn a_late_joiner_sees_who_is_there_and_hears_when_they_leave() {
            let Some((pool, rooms, board)) = setup().await else { return };
            let mut first = Client::join(&rooms, board, Role::Edit).await;
            first.next().await;
            first.send(awareness(Doc::new(), "first")).await;
            first.quiet().await;

            // Sync step 1, then everyone's presence in a frame of its own (y-websocket reads only
            // the first message of a frame, so packing them together hid everyone).
            let mut late = Client::join(&rooms, board, Role::Edit).await;
            assert!(matches!(late.next().await, Message::Sync(SyncMessage::SyncStep1(_))));
            let Message::Awareness(present) = late.next().await else {
                panic!("expected presence right after sync step 1")
            };
            assert_eq!(names(&present), ["first"]);

            // When the first one leaves, the late joiner is told its state is gone.
            first.leave().await;
            let Message::Awareness(gone) = late.expect(|m| matches!(m, Message::Awareness(_))).await
            else {
                unreachable!()
            };
            assert!(gone.clients.values().all(|e| &*e.json == "null"));

            late.leave().await;
            rooms.close_and_wait(board).await;
            db_test::delete_board(&pool, board).await;
        }

        #[tokio::test]
        async fn pings_come_back_to_the_sender_only() {
            let Some((pool, rooms, board)) = setup().await else { return };
            let mut a = Client::join(&rooms, board, Role::View).await;
            let mut b = Client::join(&rooms, board, Role::Edit).await;
            a.next().await;
            b.next().await;

            a.send(Message::Custom(103, vec![0, 0, 0, 7])).await;
            assert!(matches!(a.next().await, Message::Custom(103, data) if data == [0, 0, 0, 7]));
            assert!(!b.quiet().await.iter().any(|m| matches!(m, Message::Custom(..))));
            // Oversized pings are ignored.
            a.send(Message::Custom(103, vec![0; 64])).await;
            assert!(!a.quiet().await.iter().any(|m| matches!(m, Message::Custom(..))));

            a.leave().await;
            b.leave().await;
            rooms.close_and_wait(board).await;
            db_test::delete_board(&pool, board).await;
        }

        #[tokio::test]
        async fn a_closed_room_saves_the_board_for_the_next_one() {
            let Some((pool, rooms, board)) = setup().await else { return };
            let mut a = Client::join(&rooms, board, Role::Edit).await;
            a.next().await;
            let doc = Doc::new();
            a.send(edit(&doc, "x")).await;
            a.send(edit(&doc, "y")).await;
            a.quiet().await;
            a.leave().await;
            rooms.close_and_wait(board).await;
            assert_eq!(rooms.open_rooms(), 0);

            // A new room loads it: a client with nothing gets both shapes in step 2.
            let mut b = Client::join(&rooms, board, Role::View).await;
            b.next().await;
            b.send(Message::Sync(SyncMessage::SyncStep1(StateVector::default()))).await;
            let Message::Sync(SyncMessage::SyncStep2(state)) =
                b.expect(|m| matches!(m, Message::Sync(SyncMessage::SyncStep2(_)))).await
            else {
                unreachable!()
            };
            assert_eq!(shapes_in(&state), ["x", "y"]);

            b.leave().await;
            rooms.close_and_wait(board).await;
            db_test::delete_board(&pool, board).await;
        }
    }
}
