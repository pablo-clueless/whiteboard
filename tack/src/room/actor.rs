//! The room actor: owns a board's `yrs::Doc` and awareness, and fans out updates.
//!
//! In-memory only for now. TODO(M2): load from / persist to Postgres.

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

use super::{BoardId, ConnId, Role, RoomMsg, RoomRegistry};

/// How long an empty room stays alive before shutting down.
const IDLE_SHUTDOWN: Duration = Duration::from_secs(60);

struct Client {
    role: Role,
    tx: mpsc::Sender<Bytes>,
    /// Awareness client ids announced over this connection, cleared when it leaves.
    awareness_ids: HashSet<ClientID>,
}

struct Room {
    board_id: BoardId,
    awareness: Awareness,
    clients: HashMap<ConnId, Client>,
}

pub(super) async fn run(board_id: BoardId, mut rx: mpsc::Receiver<RoomMsg>, registry: RoomRegistry) {
    tracing::info!(%board_id, "room opened");
    let mut room = Room { board_id, awareness: Awareness::new(Doc::new()), clients: HashMap::new() };
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
        }
        idle_since = match (room.clients.is_empty(), idle_since) {
            (true, None) => Some(Instant::now()),
            (true, since) => since,
            (false, _) => None,
        };
    }

    // Stop accepting messages, then unregister so the next join spawns a fresh actor.
    rx.close();
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
        self.clients.insert(conn, Client { role, tx, awareness_ids: HashSet::new() });
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
        // TODO(M2): append to the persistence buffer.
        self.broadcast(Some(conn), &Message::Sync(SyncMessage::Update(raw)));
    }

    fn apply_awareness(&mut self, conn: ConnId, update: AwarenessUpdate) {
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
        self.broadcast(Some(conn), &Message::Awareness(update));
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
