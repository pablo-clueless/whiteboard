//! Postgres access. Plain runtime queries for now.
//! TODO: switch to sqlx's compile-time checked macros once `cargo sqlx prepare` is in the workflow.

use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

use crate::auth::{Role, TokenHash};

pub async fn connect(url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new().max_connections(10).connect(url).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

pub async fn create_board(
    pool: &PgPool,
    id: Uuid,
    edit: &TokenHash,
    view: &TokenHash,
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO boards (id) VALUES ($1)").bind(id).execute(&mut *tx).await?;
    insert_tokens(&mut tx, id, edit, view).await?;
    tx.commit().await
}

async fn insert_tokens(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    board_id: Uuid,
    edit: &TokenHash,
    view: &TokenHash,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO share_tokens (token_hash, board_id, role) VALUES ($1, $3, 'edit'), ($2, $3, 'view')",
    )
    .bind(edit.as_slice())
    .bind(view.as_slice())
    .bind(board_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Adds one more share token for a board.
pub async fn add_token(pool: &PgPool, board_id: Uuid, hash: &TokenHash, role: Role) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO share_tokens (token_hash, board_id, role) VALUES ($1, $2, $3)")
        .bind(hash.as_slice())
        .bind(board_id)
        .bind(role.as_str())
        .execute(pool)
        .await?;
    Ok(())
}

/// Replaces a board's share tokens. Old links stop working immediately.
pub async fn rotate_tokens(
    pool: &PgPool,
    board_id: Uuid,
    edit: &TokenHash,
    view: &TokenHash,
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM share_tokens WHERE board_id = $1")
        .bind(board_id)
        .execute(&mut *tx)
        .await?;
    insert_tokens(&mut tx, board_id, edit, view).await?;
    tx.commit().await
}

/// The role a token grants on a board, or None if it doesn't grant any.
pub async fn token_role(pool: &PgPool, board_id: Uuid, hash: &TokenHash) -> sqlx::Result<Option<Role>> {
    let role: Option<String> =
        sqlx::query_scalar("SELECT role FROM share_tokens WHERE token_hash = $1 AND board_id = $2")
            .bind(hash.as_slice())
            .bind(board_id)
            .fetch_optional(pool)
            .await?;
    Ok(role.and_then(|r| Role::parse(&r)))
}

#[derive(Debug, sqlx::FromRow)]
pub struct BoardRow {
    pub title: String,
    pub schema_version: i32,
}

pub async fn board(pool: &PgPool, id: Uuid) -> sqlx::Result<Option<BoardRow>> {
    sqlx::query_as("SELECT title, schema_version FROM boards WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// The latest snapshot (if any) plus every update after it, in order.
pub struct StoredDoc {
    pub snapshot: Option<Vec<u8>>,
    pub updates: Vec<Vec<u8>>,
}

pub async fn load_doc(pool: &PgPool, board_id: Uuid) -> sqlx::Result<StoredDoc> {
    let snapshot: Option<(Vec<u8>, i64)> =
        sqlx::query_as("SELECT state, upto_seq FROM board_snapshots WHERE board_id = $1")
            .bind(board_id)
            .fetch_optional(pool)
            .await?;
    let after = snapshot.as_ref().map_or(0, |(_, seq)| *seq);
    let updates: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT update FROM board_updates WHERE board_id = $1 AND seq > $2 ORDER BY seq",
    )
    .bind(board_id)
    .bind(after)
    .fetch_all(pool)
    .await?;
    Ok(StoredDoc { snapshot: snapshot.map(|(state, _)| state), updates })
}

/// Appends updates in one transaction. Returns the highest seq written.
pub async fn append_updates(pool: &PgPool, board_id: Uuid, updates: &[Vec<u8>]) -> sqlx::Result<Option<i64>> {
    if updates.is_empty() {
        return Ok(None);
    }
    let seqs: Vec<i64> = sqlx::query_scalar(
        "INSERT INTO board_updates (board_id, update) SELECT $1, u FROM UNNEST($2::bytea[]) WITH ORDINALITY AS t(u, n) ORDER BY n RETURNING seq",
    )
    .bind(board_id)
    .bind(updates)
    .fetch_all(pool)
    .await?;
    sqlx::query("UPDATE boards SET updated_at = now() WHERE id = $1")
        .bind(board_id)
        .execute(pool)
        .await?;
    Ok(seqs.into_iter().max())
}

/// Writes a snapshot covering everything up to `upto_seq` and deletes the updates it covers.
pub async fn compact(pool: &PgPool, board_id: Uuid, state: &[u8], upto_seq: i64) -> sqlx::Result<u64> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO board_snapshots (board_id, state, upto_seq) VALUES ($1, $2, $3)
         ON CONFLICT (board_id) DO UPDATE SET state = EXCLUDED.state, upto_seq = EXCLUDED.upto_seq, created_at = now()",
    )
    .bind(board_id)
    .bind(state)
    .bind(upto_seq)
    .execute(&mut *tx)
    .await?;
    let deleted = sqlx::query("DELETE FROM board_updates WHERE board_id = $1 AND seq <= $2")
        .bind(board_id)
        .bind(upto_seq)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    tx.commit().await?;
    Ok(deleted)
}

/// Highest update seq stored for a board, or 0.
pub async fn max_seq(pool: &PgPool, board_id: Uuid) -> sqlx::Result<i64> {
    let seq: Option<i64> = sqlx::query_scalar(
        "SELECT GREATEST(
            (SELECT MAX(seq) FROM board_updates WHERE board_id = $1),
            (SELECT upto_seq FROM board_snapshots WHERE board_id = $1))",
    )
    .bind(board_id)
    .fetch_one(pool)
    .await?;
    Ok(seq.unwrap_or(0))
}
