//! The audit log page.

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use super::{Page, Stat, like_pattern, list_param, order, paging};
use crate::{AppState, accounts::AdminUser, api::ApiError, types::SelectOption};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/logs", get(list))
        .route("/api/admin/logs/stats", get(stats))
        .route("/api/admin/logs/actions", get(actions))
}

/// Matches `AuditLog` in the web client, plus the details.
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AuditLog {
    #[serde(serialize_with = "crate::types::as_string")]
    id: i64,
    /// Who did it: an email, "anonymous" or "system".
    #[sqlx(rename = "actor")]
    user: String,
    #[sqlx(rename = "actor_id")]
    user_id: Option<Uuid>,
    action: String,
    resource: String,
    metadata: serde_json::Value,
    ip: Option<String>,
    created_at: DateTime<Utc>,
}

const COLUMNS: &str = "id, actor, actor_id, action, resource, metadata, ip, created_at";

pub async fn recent(pool: &PgPool, limit: i64) -> sqlx::Result<Vec<AuditLog>> {
    sqlx::query_as(crate::db::audited(format!(
        "SELECT {COLUMNS} FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT $1"
    )))
    .bind(limit)
    .fetch_all(pool)
    .await
}

#[derive(Deserialize)]
struct ListParams {
    page: Option<i64>,
    limit: Option<i64>,
    /// Matches the actor, action or resource.
    search: Option<String>,
    /// Comma-separated actions.
    action: Option<String>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    /// createdAt (default), action, user or resource.
    sort: Option<String>,
    order: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(p): Query<ListParams>,
) -> Result<Json<Page<AuditLog>>, ApiError> {
    let (page, limit, offset) = paging(p.page, p.limit);
    let sort = match p.sort.as_deref() {
        Some("action") => "action",
        Some("user") => "actor",
        Some("resource") => "resource",
        _ => "created_at",
    };
    let filter = "($1::text IS NULL OR actor ILIKE $1 OR action ILIKE $1 OR resource ILIKE $1)
        AND ($2::text[] IS NULL OR action = ANY($2))
        AND ($3::timestamptz IS NULL OR created_at >= $3)
        AND ($4::timestamptz IS NULL OR created_at < $4)";
    let search = like_pattern(p.search.as_deref());
    let actions = list_param(p.action.as_deref());

    let total: i64 =
        sqlx::query_scalar(crate::db::audited(format!("SELECT count(*) FROM audit_logs WHERE {filter}")))
            .bind(&search)
            .bind(&actions)
            .bind(p.from)
            .bind(p.to)
            .fetch_one(&state.pool)
            .await?;
    let data: Vec<AuditLog> = sqlx::query_as(crate::db::audited(format!(
        "SELECT {COLUMNS} FROM audit_logs WHERE {filter} ORDER BY {sort} {}, id DESC LIMIT $5 OFFSET $6",
        order(p.order.as_deref())
    )))
    .bind(&search)
    .bind(&actions)
    .bind(p.from)
    .bind(p.to)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(Page { data, total, page, limit }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogStats {
    /// All entries, against the total 30 days ago.
    total: Stat,
    /// Since midnight UTC, against yesterday.
    today: Stat,
    /// The last 7 days, against the 7 before.
    this_week: Stat,
    /// The last 30 days, against the 30 before.
    this_month: Stat,
}

async fn stats(State(state): State<AppState>, _admin: AdminUser) -> Result<Json<LogStats>, ApiError> {
    let row: (i64, i64, i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT count(*),
                count(*) FILTER (WHERE created_at < now() - interval '30 days'),
                count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
                count(*) FILTER (WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 day') AT TIME ZONE 'UTC'
                                   AND created_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
                count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
                count(*) FILTER (WHERE created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days'),
                count(*) FILTER (WHERE created_at >= now() - interval '30 days'),
                count(*) FILTER (WHERE created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days')
         FROM audit_logs",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(LogStats {
        total: Stat::new(row.0, row.1),
        today: Stat::new(row.2, row.3),
        this_week: Stat::new(row.4, row.5),
        this_month: Stat::new(row.6, row.7),
    }))
}

/// Every action in the log, as filter options.
async fn actions(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<SelectOption>>, ApiError> {
    let actions: Vec<String> = sqlx::query_scalar("SELECT DISTINCT action FROM audit_logs ORDER BY action")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(actions.into_iter().map(|a| SelectOption { label: a.clone(), value: a }).collect()))
}
