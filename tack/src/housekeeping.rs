//! Background cleanup: expired sessions and one-time tokens, and (when the retention policy says
//! so) old audit logs and connection records.

use std::time::Duration;

use sqlx::PgPool;

use crate::settings::SettingsStore;

const INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Marks connections left open by a previous run (a crash or kill) as ended. There's one server
/// instance, so at startup nothing is really connected.
pub async fn close_stale_connections(pool: &PgPool) -> sqlx::Result<()> {
    let closed = sqlx::query("UPDATE connections SET ended_at = now() WHERE ended_at IS NULL")
        .execute(pool)
        .await?
        .rows_affected();
    if closed > 0 {
        tracing::info!(closed, "closed connection records left open by the last run");
    }
    Ok(())
}

pub fn spawn(pool: PgPool, settings: SettingsStore) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(INTERVAL);
        loop {
            tick.tick().await;
            if let Err(err) = run_once(&pool, &settings).await {
                tracing::error!(%err, "housekeeping failed");
            }
        }
    });
}

async fn run_once(pool: &PgPool, settings: &SettingsStore) -> sqlx::Result<()> {
    let sessions = sqlx::query("DELETE FROM user_sessions WHERE expires_at <= now()")
        .execute(pool)
        .await?
        .rows_affected();
    let tokens =
        sqlx::query("DELETE FROM auth_tokens WHERE expires_at <= now()").execute(pool).await?.rows_affected();

    let retention = settings.read(|s| s.security.retention_policy.clone());
    let (mut logs, mut connections) = (0, 0);
    if retention.automatic_deletion {
        let days = retention.retention_period as i32;
        logs = sqlx::query("DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => $1)")
            .bind(days)
            .execute(pool)
            .await?
            .rows_affected();
        connections = sqlx::query(
            "DELETE FROM connections WHERE ended_at IS NOT NULL AND started_at < now() - make_interval(days => $1)",
        )
        .bind(days)
        .execute(pool)
        .await?
        .rows_affected();
    }
    tracing::debug!(sessions, tokens, logs, connections, "housekeeping done");
    Ok(())
}
