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

#[cfg(test)]
mod tests {
    //! Against the dev Postgres from docker-compose (or `TACK_TEST_DATABASE_URL`). Each test uses
    //! its own new board and deletes it afterwards. Skipped, with a note, when the database isn't
    //! reachable, so `cargo test` works without Docker running.

    use std::sync::{Arc, Mutex};

    use uuid::Uuid;
    use yrs::{Doc, GetString, Map, ReadTxn, StateVector, Text, Transact, Update, updates::decoder::Decode};

    use super::*;

    async fn pool() -> Option<PgPool> {
        let url = std::env::var("TACK_TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://tack:tack@localhost:5434/tack".into());
        // Give up quickly when there's no database, rather than after the default 30 s.
        let connect = async {
            let pool = sqlx::postgres::PgPoolOptions::new()
                .acquire_timeout(Duration::from_secs(2))
                .connect(&url)
                .await?;
            sqlx::migrate!("./migrations").run(&pool).await?;
            anyhow::Ok(pool)
        };
        match connect.await {
            Ok(pool) => Some(pool),
            Err(err) => {
                eprintln!("skipping: no test database at {url} ({err})");
                None
            }
        }
    }

    async fn new_board(pool: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        let (_, edit) = crate::auth::new_token();
        let (_, view) = crate::auth::new_token();
        db::create_board(pool, id, &edit, &view).await.unwrap();
        id
    }

    async fn delete_board(pool: &PgPool, id: Uuid) {
        sqlx::query("DELETE FROM boards WHERE id = $1").bind(id).execute(pool).await.unwrap();
    }

    /// A doc that records every update it makes, as the room would receive them.
    fn recording_doc() -> (Doc, Arc<Mutex<Vec<Vec<u8>>>>) {
        let doc = Doc::new();
        let updates = Arc::new(Mutex::new(Vec::new()));
        let sink = updates.clone();
        // Keyed observer: it stays until unobserved, i.e. for the doc's lifetime.
        doc.observe_update_v1("record", move |_: &yrs::TransactionMut, e| {
            sink.lock().unwrap().push(e.update.clone());
        })
        .unwrap();
        (doc, updates)
    }

    /// Rebuilds a doc from what's stored, the way a room opening does.
    async fn reload(pool: &PgPool, board: Uuid) -> (Doc, db::StoredDoc) {
        let stored = db::load_doc(pool, board).await.unwrap();
        let doc = Doc::new();
        {
            let mut txn = doc.transact_mut();
            for bytes in stored.snapshot.iter().chain(&stored.updates) {
                txn.apply_update(Update::decode_v1(bytes).unwrap()).unwrap();
            }
        }
        (doc, stored)
    }

    fn title(doc: &Doc) -> String {
        let text = doc.get_or_insert_text("title");
        text.get_string(&doc.transact())
    }

    fn shape_count(doc: &Doc) -> u32 {
        let shapes = doc.get_or_insert_map("shapes");
        shapes.len(&doc.transact())
    }

    #[tokio::test]
    async fn updates_survive_a_reload_and_a_compaction() {
        let Some(pool) = pool().await else { return };
        let board = new_board(&pool).await;

        let (doc, updates) = recording_doc();
        let shapes = doc.get_or_insert_map("shapes");
        let heading = doc.get_or_insert_text("title");
        shapes.insert(&mut doc.transact_mut(), "a", "rect");
        shapes.insert(&mut doc.transact_mut(), "b", "ellipse");
        heading.insert(&mut doc.transact_mut(), 0, "Plan");
        let recorded = updates.lock().unwrap().clone();
        assert_eq!(recorded.len(), 3);
        db::append_updates(&pool, board, &recorded).await.unwrap();

        // Every update comes back, in order.
        let (loaded, stored) = reload(&pool, board).await;
        assert!(stored.snapshot.is_none());
        assert_eq!(stored.updates, recorded);
        assert_eq!((shape_count(&loaded), title(&loaded)), (2, "Plan".into()));

        // Compaction folds them into one snapshot and deletes them.
        let state = doc.transact().encode_state_as_update_v1(&StateVector::default());
        let upto = db::max_seq(&pool, board).await.unwrap();
        assert_eq!(db::compact(&pool, board, &state, upto).await.unwrap(), 3);

        // An edit after the snapshot is loaded on top of it.
        shapes.insert(&mut doc.transact_mut(), "c", "text");
        let later = updates.lock().unwrap().last().unwrap().clone();
        db::append_updates(&pool, board, &[later]).await.unwrap();

        let (loaded, stored) = reload(&pool, board).await;
        assert!(stored.snapshot.is_some());
        assert_eq!(stored.updates.len(), 1);
        assert_eq!(shape_count(&loaded), 3);
        assert_eq!(title(&loaded), "Plan");

        delete_board(&pool, board).await;
    }

    #[tokio::test]
    async fn the_persister_saves_everything_before_it_closes() {
        let Some(pool) = pool().await else { return };
        let board = new_board(&pool).await;

        let (doc, updates) = recording_doc();
        let shapes = doc.get_or_insert_map("shapes");
        for i in 0..5 {
            shapes.insert(&mut doc.transact_mut(), format!("s{i}"), i as i64);
        }

        // Buffered (well within FLUSH_INTERVAL), then flushed by close.
        let persister = Persister::spawn(pool.clone(), board);
        for u in updates.lock().unwrap().iter() {
            persister.update(u.clone());
        }
        persister.close().await;
        let (loaded, stored) = reload(&pool, board).await;
        assert_eq!(stored.updates.len(), 5);
        assert_eq!(shape_count(&loaded), 5);

        // A snapshot request flushes first, then compacts what's stored.
        let persister = Persister::spawn(pool.clone(), board);
        shapes.insert(&mut doc.transact_mut(), "s5", 5i64);
        persister.update(updates.lock().unwrap().last().unwrap().clone());
        persister.snapshot(doc.transact().encode_state_as_update_v1(&StateVector::default()));
        persister.close().await;
        let (loaded, stored) = reload(&pool, board).await;
        assert!(stored.snapshot.is_some());
        assert!(stored.updates.is_empty());
        assert_eq!(shape_count(&loaded), 6);

        delete_board(&pool, board).await;
    }
}
