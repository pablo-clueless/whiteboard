//! Writes a room's updates to Postgres off the actor's hot path.
//!
//! The actor hands every applied update to this task and never waits on the database. Updates are
//! buffered and written in one transaction every FLUSH_INTERVAL or FLUSH_BATCH updates. A
//! snapshot request flushes first, then folds everything stored so far into `board_snapshots`.
//!
//! Crash window: up to FLUSH_INTERVAL of updates can be lost if the server dies. Connected
//! clients still hold them and send them back during the sync handshake when they reconnect.

use std::time::Duration;

use sqlx::PgPool;
use tokio::{sync::mpsc, task::JoinHandle, time::MissedTickBehavior};

use super::BoardId;
use crate::db;

const FLUSH_INTERVAL: Duration = Duration::from_millis(250);
const FLUSH_BATCH: usize = 100;

enum PersistMsg {
    Update(Vec<u8>),
    /// Full encoded doc state, covering every update sent before it.
    Snapshot(Vec<u8>),
}

pub(super) struct Persister {
    tx: mpsc::UnboundedSender<PersistMsg>,
    task: JoinHandle<()>,
}

impl Persister {
    pub fn spawn(pool: PgPool, board_id: BoardId) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(pool, board_id, rx));
        Self { tx, task }
    }

    pub fn update(&self, update: Vec<u8>) {
        let _ = self.tx.send(PersistMsg::Update(update));
    }

    pub fn snapshot(&self, state: Vec<u8>) {
        let _ = self.tx.send(PersistMsg::Snapshot(state));
    }

    /// Writes everything still buffered and waits until it's done.
    pub async fn close(self) {
        drop(self.tx);
        let _ = self.task.await;
    }
}

async fn run(pool: PgPool, board_id: BoardId, mut rx: mpsc::UnboundedReceiver<PersistMsg>) {
    let mut buffer: Vec<Vec<u8>> = Vec::new();
    let mut tick = tokio::time::interval(FLUSH_INTERVAL);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Some(PersistMsg::Update(u)) => {
                    buffer.push(u);
                    if buffer.len() >= FLUSH_BATCH {
                        flush(&pool, board_id, &mut buffer).await;
                    }
                }
                Some(PersistMsg::Snapshot(state)) => {
                    flush(&pool, board_id, &mut buffer).await;
                    compact(&pool, board_id, &state).await;
                }
                None => {
                    flush(&pool, board_id, &mut buffer).await;
                    if !buffer.is_empty() {
                        tracing::error!(%board_id, lost = buffer.len(), "room closed with unsaved updates");
                    }
                    return;
                }
            },
            _ = tick.tick() => flush(&pool, board_id, &mut buffer).await,
        }
    }
}

/// Appends buffered updates. On failure they stay buffered and are retried on the next tick.
async fn flush(pool: &PgPool, board_id: BoardId, buffer: &mut Vec<Vec<u8>>) {
    if buffer.is_empty() {
        return;
    }
    match db::append_updates(pool, board_id, buffer).await {
        Ok(_) => buffer.clear(),
        Err(err) => tracing::error!(%board_id, %err, pending = buffer.len(), "failed to save updates"),
    }
}

async fn compact(pool: &PgPool, board_id: BoardId, state: &[u8]) {
    // Every update the snapshot covers was sent (and flushed) before it, so it covers all stored
    // seqs. Anything still buffered after a failed flush is also inside the snapshot; replaying it
    // later is harmless because Yjs updates are idempotent.
    let result = async {
        let upto = db::max_seq(pool, board_id).await?;
        db::compact(pool, board_id, state, upto).await
    }
    .await;
    match result {
        Ok(deleted) => tracing::debug!(%board_id, deleted, bytes = state.len(), "compacted"),
        Err(err) => tracing::error!(%board_id, %err, "failed to compact"),
    }
}
