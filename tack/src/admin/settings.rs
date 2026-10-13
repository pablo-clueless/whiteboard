//! The settings page: platform, security and board settings, feature flags, and system health.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    AppState,
    accounts::AdminUser,
    api::ApiError,
    audit,
    request_meta::RequestMeta,
    settings::{BoardSettings, Platform, Section, Security},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/settings", get(all))
        .route("/api/admin/settings/history", get(history))
        .route("/api/admin/settings/{section}", patch(update))
        .route("/api/admin/feature-flags", get(list_flags).post(create_flag))
        .route("/api/admin/feature-flags/{id}", patch(update_flag).delete(delete_flag))
        .route("/api/admin/system/health", get(health))
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct FeatureFlag {
    id: String,
    name: String,
    enabled: bool,
    description: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FeatureFlags {
    feature_flags: Vec<FeatureFlag>,
}

#[derive(Serialize)]
struct Storage {
    used: String,
    available: String,
}

#[derive(Serialize)]
struct SystemHealthSummary {
    storage: Storage,
}

/// Matches `SystemConfiguration` in the web client.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemConfiguration {
    platform: Platform,
    security: Security,
    board: BoardSettings,
    feature_flags: FeatureFlags,
    system_health: SystemHealthSummary,
}

async fn load_flags(state: &AppState) -> sqlx::Result<Vec<FeatureFlag>> {
    sqlx::query_as(
        "SELECT id, name, enabled, description, created_at, updated_at FROM feature_flags ORDER BY name",
    )
    .fetch_all(&state.pool)
    .await
}

async fn all(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<SystemConfiguration>, ApiError> {
    let settings = state.settings.get();
    let storage = storage(&state).await?;
    Ok(Json(SystemConfiguration {
        platform: settings.platform,
        security: settings.security,
        board: settings.board,
        feature_flags: FeatureFlags { feature_flags: load_flags(&state).await? },
        system_health: SystemHealthSummary {
            storage: Storage {
                used: format_bytes(storage.used_bytes),
                available: storage.available_bytes.map_or_else(|| "unknown".into(), format_bytes),
            },
        },
    }))
}

/// Changes part of one section: `PATCH /api/admin/settings/security` with
/// `{ "sessionTimeout": 120 }` leaves the other security settings as they are.
async fn update(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(section): Path<String>,
    Json(patch): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let section: Section = crate::accounts::parse_enum(&section).ok_or(ApiError::NotFound)?;
    if !patch.is_object() {
        return Err(ApiError::BadRequest("send an object of settings to change".into()));
    }
    let before = state.settings.read(|s| match section {
        Section::Platform => serde_json::to_value(&s.platform),
        Section::Security => serde_json::to_value(&s.security),
        Section::Board => serde_json::to_value(&s.board),
    });
    let before = before.unwrap_or_default();
    // What the changed settings were, so the history can show old and new side by side.
    let previous: serde_json::Map<String, serde_json::Value> = patch
        .as_object()
        .into_iter()
        .flat_map(|p| p.keys())
        .map(|k| (k.clone(), before.get(k).cloned().unwrap_or_default()))
        .collect();
    let updated = state.settings.update(&state.pool, section, patch.clone()).await?;
    // Locks only count while the read-only switch is on, so open boards may need telling.
    if section == Section::Board {
        state.rooms.settings_changed().await;
    }
    let resource = format!("settings:{}", crate::accounts::enum_str(section));
    audit::record(
        &state.pool,
        &admin,
        "settings.updated",
        resource,
        json!({ "changes": patch, "previous": previous }),
        Some(&meta),
    )
    .await;
    Ok(Json(updated))
}

#[derive(Deserialize)]
struct HistoryParams {
    /// platform, security or board; every settings section and feature flag when left out.
    section: Option<String>,
}

/// The latest changes to settings and feature flags, newest first, for "who changed what".
async fn history(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(p): Query<HistoryParams>,
) -> Result<Json<Vec<super::logs::AuditLog>>, ApiError> {
    let resource = match p.section.as_deref() {
        Some(section) => {
            let section: Section = crate::accounts::parse_enum(section).ok_or(ApiError::NotFound)?;
            Some(format!("settings:{}", crate::accounts::enum_str(section)))
        }
        None => None,
    };
    let logs = sqlx::query_as(
        "SELECT id, actor, actor_id, action, resource, metadata, ip, created_at FROM audit_logs
         WHERE CASE WHEN $1::text IS NULL THEN resource LIKE 'settings:%' OR resource LIKE 'feature_flag:%'
                    ELSE resource = $1 END
         ORDER BY created_at DESC, id DESC LIMIT 20",
    )
    .bind(resource)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(logs))
}

async fn list_flags(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<FeatureFlag>>, ApiError> {
    Ok(Json(load_flags(&state).await?))
}

#[derive(Deserialize)]
struct NewFlag {
    /// A stable key the client checks, like `presence-v2`. Made from the name when left out.
    id: Option<String>,
    name: String,
    description: Option<String>,
    #[serde(default)]
    enabled: bool,
}

fn slug(name: &str) -> String {
    let mut slug = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    slug.trim_end_matches('-').to_owned()
}

fn valid_flag_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

fn flag_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(ApiError::BadRequest("name must be 1 to 100 characters".into()));
    }
    Ok(name.to_owned())
}

async fn create_flag(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Json(body): Json<NewFlag>,
) -> Result<(StatusCode, Json<FeatureFlag>), ApiError> {
    let name = flag_name(&body.name)?;
    let id = body.id.map(|id| id.trim().to_owned()).unwrap_or_else(|| slug(&name));
    if !valid_flag_id(&id) {
        return Err(ApiError::BadRequest(
            "id must be up to 64 lowercase letters, digits, '-', '_' or '.', starting with a letter or digit"
                .into(),
        ));
    }
    let result = sqlx::query_as::<_, FeatureFlag>(
        "INSERT INTO feature_flags (id, name, description, enabled) VALUES ($1, $2, $3, $4)
         RETURNING id, name, enabled, description, created_at, updated_at",
    )
    .bind(&id)
    .bind(&name)
    .bind(body.description.as_deref().map(str::trim).filter(|d| !d.is_empty()))
    .bind(body.enabled)
    .fetch_one(&state.pool)
    .await;
    let flag = match result {
        Ok(flag) => flag,
        Err(sqlx::Error::Database(err)) if err.is_unique_violation() => {
            return Err(ApiError::Conflict(format!("there's already a flag called {id:?}")));
        }
        Err(err) => return Err(err.into()),
    };
    let metadata = json!({ "enabled": flag.enabled });
    audit::record(
        &state.pool,
        &admin,
        "feature_flag.created",
        format!("feature_flag:{id}"),
        metadata,
        Some(&meta),
    )
    .await;
    Ok((StatusCode::CREATED, Json(flag)))
}

#[derive(Deserialize)]
struct FlagPatch {
    name: Option<String>,
    /// Null clears it.
    #[serde(default)]
    description: Option<Option<String>>,
    enabled: Option<bool>,
}

async fn update_flag(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<String>,
    Json(body): Json<FlagPatch>,
) -> Result<Json<FeatureFlag>, ApiError> {
    let name = body.name.as_deref().map(flag_name).transpose()?;
    let description =
        body.description.clone().map(|d| d.map(|d| d.trim().to_owned()).filter(|d| !d.is_empty()));
    let flag: FeatureFlag = sqlx::query_as(
        "UPDATE feature_flags SET name = COALESCE($2, name),
           description = CASE WHEN $3 THEN $4 ELSE description END,
           enabled = COALESCE($5, enabled), updated_at = now()
         WHERE id = $1 RETURNING id, name, enabled, description, created_at, updated_at",
    )
    .bind(&id)
    .bind(&name)
    .bind(description.is_some())
    .bind(description.flatten())
    .bind(body.enabled)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;
    let metadata = json!({ "name": name, "enabled": body.enabled });
    audit::record(
        &state.pool,
        &admin,
        "feature_flag.updated",
        format!("feature_flag:{id}"),
        metadata,
        Some(&meta),
    )
    .await;
    Ok(Json(flag))
}

async fn delete_flag(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = sqlx::query("DELETE FROM feature_flags WHERE id = $1")
        .bind(&id)
        .execute(&state.pool)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound);
    }
    audit::record(
        &state.pool,
        &admin,
        "feature_flag.deleted",
        format!("feature_flag:{id}"),
        json!({}),
        Some(&meta),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

struct StorageBytes {
    used_bytes: i64,
    /// Quota minus used, when TACK_STORAGE_QUOTA_BYTES is set.
    available_bytes: Option<i64>,
    quota_bytes: Option<i64>,
}

async fn storage(state: &AppState) -> sqlx::Result<StorageBytes> {
    let used_bytes: i64 =
        sqlx::query_scalar("SELECT pg_database_size(current_database())").fetch_one(&state.pool).await?;
    let quota_bytes = state.config.storage_quota_bytes.map(|q| q as i64);
    Ok(StorageBytes {
        used_bytes,
        available_bytes: quota_bytes.map(|q| (q - used_bytes).max(0)),
        quota_bytes,
    })
}

fn format_bytes(bytes: i64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 { format!("{bytes} B") } else { format!("{value:.1} {}", UNITS[unit]) }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    /// "ok", or "degraded" when the database is slow or storage is nearly full.
    status: &'static str,
    version: &'static str,
    started_at: DateTime<Utc>,
    uptime_seconds: u64,
    database: DatabaseHealth,
    storage: StorageHealth,
    rooms: RoomHealth,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseHealth {
    latency_ms: f64,
    pool_size: u32,
    pool_idle: usize,
    pool_max: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageHealth {
    used: String,
    available: String,
    used_bytes: i64,
    available_bytes: Option<i64>,
    quota_bytes: Option<i64>,
    /// Bytes per table, largest first.
    tables: Vec<TableSize>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct TableSize {
    name: String,
    bytes: i64,
    rows: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomHealth {
    open: usize,
    connected_clients: usize,
}

/// A database round trip slower than this marks the server degraded.
const SLOW_DB_MS: f64 = 250.0;

async fn health(State(state): State<AppState>, _admin: AdminUser) -> Result<Json<Health>, ApiError> {
    let start = std::time::Instant::now();
    sqlx::query("SELECT 1").execute(&state.pool).await?;
    let latency_ms = (start.elapsed().as_secs_f64() * 10_000.0).round() / 10.0;

    let storage = storage(&state).await?;
    let tables: Vec<TableSize> = sqlx::query_as(
        "SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes, GREATEST(c.reltuples, 0)::bigint AS rows
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_sqlx_migrations'
         ORDER BY bytes DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    let nearly_full =
        matches!((storage.available_bytes, storage.quota_bytes), (Some(a), Some(q)) if q > 0 && a * 10 < q);

    Ok(Json(Health {
        status: if latency_ms > SLOW_DB_MS || nearly_full { "degraded" } else { "ok" },
        version: env!("CARGO_PKG_VERSION"),
        started_at: state.started_at,
        uptime_seconds: (Utc::now() - state.started_at).num_seconds().max(0) as u64,
        database: DatabaseHealth {
            latency_ms,
            pool_size: state.pool.size(),
            pool_idle: state.pool.num_idle(),
            pool_max: state.pool.options().get_max_connections(),
        },
        storage: StorageHealth {
            used: format_bytes(storage.used_bytes),
            available: storage.available_bytes.map_or_else(|| "unknown".into(), format_bytes),
            used_bytes: storage.used_bytes,
            available_bytes: storage.available_bytes,
            quota_bytes: storage.quota_bytes,
            tables,
        },
        rooms: RoomHealth { open: state.rooms.open_rooms(), connected_clients: state.rooms.total_clients() },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_ids_and_sizes() {
        assert_eq!(slug("  Presence v2!  "), "presence-v2");
        assert!(valid_flag_id("presence-v2"));
        assert!(!valid_flag_id("-x"));
        assert!(!valid_flag_id("Upper"));
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1536), "1.5 KB");
        assert_eq!(format_bytes(20 * 1024 * 1024), "20.0 MB");
    }
}
