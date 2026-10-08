//! The room actor: owns a board's `yrs::Doc` and awareness, and fans out updates.
//!
//! The board is loaded from Postgres when the room opens. Every applied update is handed to the
//! persister; every COMPACT_AFTER updates (and when the room closes) the full doc state is saved
//! as a snapshot so loading stays fast.

use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use bytes::Bytes;
use tokio::{
    sync::mpsc::{self, error::TrySendError},
    time::Instant,
};
use yrs::{
    ClientID, Doc, ReadTxn, StateVector, Transact, Update,
    encoding::read::Cursor,
    sync::{Awareness, AwarenessUpdate, DefaultProtocol, Message, MessageReader, Protocol, SyncMessage},
    updates::{
        decoder::{Decode, DecoderV1},
        encoder::{Encode, Encoder, EncoderV1},
    },
};

use super::{BoardId, ConnId, Role, RoomMsg, RoomRegistry, persist::Persister};
use crate::db;

/// How long an empty room stays alive before saving and shutting down.
const IDLE_SHUTDOWN: Duration = Duration::from_secs(60);
/// Updates since the last snapshot before the room writes a new one.
const COMPACT_AFTER: usize = 500;
/// Custom y-websocket message type telling an editor the board is full and its edits aren't being
/// saved. Matches `MESSAGE_BOARD_FULL` in the web client. Sent once per connection.
const MSG_BOARD_FULL: u8 = 100;

struct Client {
    role: Role,
    tx: mpsc::Sender<Bytes>,
    /// Awareness client ids announced over this connection, cleared when it leaves.
    awareness_ids: HashSet<ClientID>,
    /// Already told the board is full.
    told_full: bool,
}

struct Room {
    board_id: BoardId,
    awareness: Awareness,
    clients: HashMap<ConnId, Client>,
    persister: Persister,
    updates_since_snapshot: usize,
    /// Approximate encoded size: last snapshot plus every update applied since.
    doc_bytes: usize,
    max_doc_bytes: usize,
    /// An edit was refused for size. Editors who join are told straight away.
    full: bool,
}

pub(super) async fn run(board_id: BoardId, mut rx: mpsc::Receiver<RoomMsg>, registry: RoomRegistry) {
    let doc = Doc::new();
    let stored = match db::load_doc(&registry.pool, board_id).await {
        Ok(stored) => stored,
        Err(err) => {
            // Refuse joins rather than serve an empty board that would then overwrite nothing
            // but confuse everyone. Clients retry with backoff.
            tracing::error!(%board_id, %err, "failed to load board; closing room");
            rx.close();
            registry.remove_closed(board_id);
            return;
        }
    };
    let mut doc_bytes = 0;
    {
        let mut txn = doc.transact_mut();
        for bytes in stored.snapshot.iter().chain(&stored.updates) {
            doc_bytes += bytes.len();
            match Update::decode_v1(bytes) {
                Ok(update) => {
                    if let Err(err) = txn.apply_update(update) {
                        tracing::error!(%board_id, %err, "stored update failed to apply");
                    }
                }
                Err(err) => tracing::error!(%board_id, %err, "stored update failed to decode"),
            }
        }
    }
    tracing::info!(
        %board_id,
        snapshot = stored.snapshot.is_some(),
        updates = stored.updates.len(),
        bytes = doc_bytes,
        "room opened"
    );

    let mut room = Room {
        board_id,
        awareness: Awareness::new(doc),
        clients: HashMap::new(),
        persister: Persister::spawn(registry.pool.clone(), board_id),
        updates_since_snapshot: stored.updates.len(),
        doc_bytes,
        max_doc_bytes: registry.max_doc_bytes,
        full: doc_bytes >= registry.max_doc_bytes,
    };
    let mut idle_since = Some(Instant::now());

    loop {
        let msg = match idle_since {
            Some(since) => tokio::select! {
                msg = rx.recv() => msg,
                _ = tokio::time::sleep_until(since + IDLE_SHUTDOWN) => None,
            },
            None => rx.recv().await,
        };
        let Some(msg) = msg else { break };

        match msg {
            RoomMsg::Join { conn, role, tx } => room.join(conn, role, tx),
            RoomMsg::Message { conn, data } => room.handle(conn, &data),
            RoomMsg::Leave { conn } => room.leave(conn),
            RoomMsg::DisconnectAll => {
                let conns: Vec<_> = room.clients.keys().copied().collect();
                tracing::info!(%board_id, count = conns.len(), "disconnecting everyone");
                conns.into_iter().for_each(|c| room.leave(c));
            }
        }
        idle_since = match (room.clients.is_empty(), idle_since) {
            (true, None) => Some(Instant::now()),
            (true, since) => since,
            (false, _) => None,
        };
    }

    // Stop accepting messages and save everything before unregistering, so the next actor for
    // this board loads the final state.
    rx.close();
    if room.updates_since_snapshot > 0 {
        room.snapshot();
    }
    room.persister.close().await;
    registry.remove_closed(board_id);
    tracing::info!(%board_id, "room closed");
}
impl Room {
    fn join(&mut self, conn: ConnId, role: Role, tx: mpsc::Sender<Bytes>) {
        // Sync step 1 + current awareness, so the client sends what we're missing.
        let mut encoder = EncoderV1::new();
        if let Err(err) = DefaultProtocol.start(&self.awareness, &mut encoder) {
            tracing::error!(board_id = %self.board_id, %err, "failed to encode sync start");
            return;
        }
        if tx.try_send(encoder.to_vec().into()).is_err() {
            return;
        }
        self.clients.insert(conn, Client { role, tx, awareness_ids: HashSet::new(), told_full: false });
        // An editor joining a board that's already full should know before it edits anything.
        if role == Role::Edit && self.full {
            self.tell_full(conn);
        }
    }

    /// Tells an editor (once) that the board is full and further edits won't be kept.
    fn tell_full(&mut self, conn: ConnId) {
        let Some(client) = self.clients.get_mut(&conn) else { return };
        if client.told_full {
            return;
        }
        client.told_full = true;
        self.send_to(conn, &Message::Custom(MSG_BOARD_FULL, Vec::new()));
    }

    fn leave(&mut self, conn: ConnId) {
        let Some(client) = self.clients.remove(&conn) else { return };
        if client.awareness_ids.is_empty() {
            return;
        }
        // Tell everyone else this connection's cursors are gone.
        for &id in &client.awareness_ids {
            self.awareness.remove_state(id);
        }
        match self.awareness.update_with_clients(client.awareness_ids) {
            Ok(update) => self.broadcast(Some(conn), &Message::Awareness(update)),
            Err(err) => tracing::warn!(board_id = %self.board_id, %err, "awareness cleanup failed"),
        }
    }

    fn handle(&mut self, conn: ConnId, data: &[u8]) {
        let Some(role) = self.clients.get(&conn).map(|c| c.role) else { return };
        let mut decoder = DecoderV1::new(Cursor::new(data));

        for msg in MessageReader::new(&mut decoder) {
            let msg = match msg {
                Ok(msg) => msg,
                Err(err) => {
                    tracing::warn!(board_id = %self.board_id, %conn, %err, "undecodable message");
                    return;
                }
            };
            match msg {
                Message::Sync(SyncMessage::SyncStep1(sv)) => self.reply_step2(conn, &sv),
                Message::Sync(SyncMessage::SyncStep2(update) | SyncMessage::Update(update)) => {
                    if role == Role::Edit {
                        self.apply_update(conn, update);
                    }
                }
                Message::Awareness(update) => self.apply_awareness(conn, update),
                Message::AwarenessQuery => match self.awareness.update() {
                    Ok(update) => self.send_to(conn, &Message::Awareness(update)),
                    Err(err) => tracing::warn!(board_id = %self.board_id, %err, "awareness query failed"),
                },
                Message::Auth(_) | Message::Custom(..) => {}
            }
        }
    }

    fn reply_step2(&mut self, conn: ConnId, sv: &StateVector) {
        let update = self.awareness.doc().transact().encode_state_as_update_v1(sv);
        self.send_to(conn, &Message::Sync(SyncMessage::SyncStep2(update)));
    }

    fn apply_update(&mut self, conn: ConnId, raw: Vec<u8>) {
        if self.doc_bytes + raw.len() > self.max_doc_bytes {
            // The sender keeps its change locally and stays out of sync with the room for it, so
            // tell it: the client stops editing and says why.
            tracing::warn!(board_id = %self.board_id, %conn, bytes = self.doc_bytes, "board full; update dropped");
            self.full = true;
            self.tell_full(conn);
            return;
        }
        let update = match Update::decode_v1(&raw) {
            Ok(update) => update,
            Err(err) => {
                tracing::warn!(board_id = %self.board_id, %conn, %err, "undecodable update");
                return;
            }
        };
        if let Err(err) = self.awareness.doc().transact_mut().apply_update(update) {
            tracing::warn!(board_id = %self.board_id, %conn, %err, "failed to apply update");
            return;
        }
        self.doc_bytes += raw.len();
        self.updates_since_snapshot += 1;
        self.persister.update(raw.clone());
        self.broadcast(Some(conn), &Message::Sync(SyncMessage::Update(raw)));
        if self.updates_since_snapshot >= COMPACT_AFTER {
            self.snapshot();
        }
    }

    /// Hands the full doc state to the persister, which folds stored updates into it.
    fn snapshot(&mut self) {
        let state = self.awareness.doc().transact().encode_state_as_update_v1(&StateVector::default());
        self.doc_bytes = state.len();
        // Compaction can shrink a board back under the limit.
        self.full = self.doc_bytes >= self.max_doc_bytes;
        self.updates_since_snapshot = 0;
        self.persister.snapshot(state);
    }

    fn apply_awareness(&mut self, conn: ConnId, mut update: AwarenessUpdate) {
        // When a connection drops we announce its clients as gone at clock + 1. If one reconnects
        // it re-announces at its old clock, which everyone (us included) would ignore as stale.
        // Stamp it past the removal; the echo below lets the client's own clock catch up.
        for (&id, entry) in update.clients.iter_mut() {
            if &*entry.json == "null" {
                continue;
            }
            let removed = self.awareness.state::<serde_json::Value>(id).is_none();
            if let Some((clock, _)) = self.awareness.meta(id)
                && removed
                && entry.clock <= clock
            {
                entry.clock = clock + 1;
            }
        }

        if let Err(err) = self.awareness.apply_update(update.clone()) {
            tracing::warn!(board_id = %self.board_id, %conn, %err, "bad awareness update");
            return;
        }
        if let Some(client) = self.clients.get_mut(&conn) {
            for (&id, entry) in &update.clients {
                if &*entry.json == "null" {
                    client.awareness_ids.remove(&id);
                } else {
                    client.awareness_ids.insert(id);
                }
            }
        }
        // Echoed to the sender too, like the reference y-websocket server. y-websocket drops a
        // connection that hears nothing for 30 s, and the client renews its awareness every 15 s,
        // so without the echo anyone alone on a board would reconnect every 30 s.
        self.broadcast(None, &Message::Awareness(update));
    }

    fn send_to(&mut self, conn: ConnId, msg: &Message) {
        let bytes = Bytes::from(msg.encode_v1());
        if let Some(client) = self.clients.get(&conn)
            && client.tx.try_send(bytes).is_err()
        {
            self.evict(conn);
        }
    }

    /// Encodes once and sends the same bytes to every client except `skip`.
    fn broadcast(&mut self, skip: Option<ConnId>, msg: &Message) {
        let bytes = Bytes::from(msg.encode_v1());
        let mut slow = Vec::new();
        for (&id, client) in &self.clients {
            if Some(id) == skip {
                continue;
            }
            match client.tx.try_send(bytes.clone()) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) | Err(TrySendError::Closed(_)) => slow.push(id),
            }
        }
        for id in slow {
            self.evict(id);
        }
    }

    /// Drops a client that can't keep up. Its writer ends and it resyncs on reconnect.
    fn evict(&mut self, conn: ConnId) {
        tracing::warn!(board_id = %self.board_id, %conn, "evicting slow or closed client");
        self.leave(conn);
    }
}
