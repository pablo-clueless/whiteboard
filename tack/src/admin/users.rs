//! The users page: accounts, their sessions, and account actions.
//!
//! Guard rails: only a superadmin can edit a superadmin or make one; nobody can change their own
//! status, role or type; and the last active superadmin can't be demoted, suspended or deleted.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::{Page, Stat, like_pattern, list_param, order, paging, period_bounds, period_days};
use crate::{
    AppState,
    accounts::{
        self, AdminUser, NewUser, OneTimeKind, PermissionLevel, USER_COLUMNS, User, UserRow, UserStatus,
        UserType, enum_str, is_valid_permission,
    },
    api::ApiError,
    audit, mail,
    request_meta::RequestMeta,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/users", get(list).post(create))
        .route("/api/admin/users/stats", get(stats))
        .route("/api/admin/users/bulk", post(bulk))
        .route("/api/admin/users/{id}", get(detail).patch(update).delete(remove))
        .route("/api/admin/users/{id}/sessions", get(sessions).delete(revoke_all))
        .route("/api/admin/users/{id}/sessions/{session_id}", delete(revoke_one))
        .route("/api/admin/users/{id}/reset-password", post(send_reset))
        .route("/api/admin/users/{id}/unlock", post(unlock))
        .route("/api/admin/users/{id}/reset-two-factor", post(reset_two_factor))
}

#[derive(Deserialize)]
struct ListParams {
    page: Option<i64>,
    limit: Option<i64>,
    /// Matches name or email.
    search: Option<String>,
    /// Comma-separated statuses.
    status: Option<String>,
    /// Comma-separated roles.
    role: Option<String>,
    /// Comma-separated types.
    #[serde(rename = "type")]
    kind: Option<String>,
    /// name, email, status, createdAt (default), updatedAt or lastSeenAt.
    sort: Option<String>,
    order: Option<String>,
}

#[derive(sqlx::FromRow)]
struct CountedUser {
    #[sqlx(flatten)]
    user: UserRow,
    total: i64,
}

async fn list(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(p): Query<ListParams>,
) -> Result<Json<Page<User>>, ApiError> {
    let (page, limit, offset) = paging(p.page, p.limit);
    let sort = match p.sort.as_deref() {
        Some("name") => "u.name",
        Some("email") => "u.email",
        Some("status") => "u.status",
        Some("updatedAt") => "u.updated_at",
        Some("lastSeenAt") => "u.last_seen_at",
        _ => "u.created_at",
    };
    let rows: Vec<CountedUser> = sqlx::query_as(crate::db::audited(format!(
        "SELECT {USER_COLUMNS}, count(*) OVER () AS total FROM users u
         WHERE ($1::text IS NULL OR u.name ILIKE $1 OR u.email ILIKE $1)
           AND ($2::text[] IS NULL OR u.status = ANY($2))
           AND ($3::text[] IS NULL OR u.role = ANY($3))
           AND ($4::text[] IS NULL OR u.type = ANY($4))
         ORDER BY {sort} {} NULLS LAST, u.id LIMIT $5 OFFSET $6",
        order(p.order.as_deref())
    )))
    .bind(like_pattern(p.search.as_deref()))
    .bind(list_param(p.status.as_deref()))
    .bind(list_param(p.role.as_deref()))
    .bind(list_param(p.kind.as_deref()))
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    let total = rows.first().map_or(0, |r| r.total);
    Ok(Json(Page { data: rows.into_iter().map(|r| r.user.into()).collect(), total, page, limit }))
}

#[derive(Deserialize)]
struct PeriodParams {
    period: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserStats {
    period: i64,
    /// Accounts, not counting deleted ones, against the count at the start of the period.
    total_users: Stat,
    /// Accounts that signed in or opened a board in the period.
    monthly_active_users: Stat,
    /// Distinct visitors in the period, signed in or not.
    monthly_unique_users: Stat,
    /// Accounts created in the period.
    monthly_new_users: Stat,
}

async fn stats(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(p): Query<PeriodParams>,
) -> Result<Json<UserStats>, ApiError> {
    let days = period_days(p.period);
    let (prev, start, now) = period_bounds(days);
    let pool = &state.pool;
    let (total, total_before, new, prev_new): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE status <> 'deleted'),
                count(*) FILTER (WHERE status <> 'deleted' AND created_at < $2),
                count(*) FILTER (WHERE created_at >= $2),
                count(*) FILTER (WHERE created_at >= $1 AND created_at < $2)
         FROM users",
    )
    .bind(prev)
    .bind(start)
    .fetch_one(pool)
    .await?;
    let (active, prev_active): (i64, i64) = sqlx::query_as(
        "WITH activity AS (
            SELECT user_id, started_at AS at FROM connections WHERE user_id IS NOT NULL AND started_at >= $1
            UNION ALL
            SELECT actor_id, created_at FROM audit_logs WHERE action = 'auth.signin' AND actor_id IS NOT NULL AND created_at >= $1
         )
         SELECT count(DISTINCT user_id) FILTER (WHERE at >= $2), count(DISTINCT user_id) FILTER (WHERE at < $2)
         FROM activity WHERE at < $3",
    )
    .bind(prev)
    .bind(start)
    .bind(now)
    .fetch_one(pool)
    .await?;
    let (unique, prev_unique): (i64, i64) = sqlx::query_as(
        "SELECT count(DISTINCT visitor_id) FILTER (WHERE started_at >= $2),
                count(DISTINCT visitor_id) FILTER (WHERE started_at < $2)
         FROM connections WHERE started_at >= $1 AND started_at < $3",
    )
    .bind(prev)
    .bind(start)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(Json(UserStats {
        period: days,
        total_users: Stat::new(total, total_before),
        monthly_active_users: Stat::new(active, prev_active),
        monthly_unique_users: Stat::new(unique, prev_unique),
        monthly_new_users: Stat::new(new, prev_new),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody {
    name: String,
    email: String,
    /// Without one, the account gets an unusable password and the user is emailed a link to set
    /// their own.
    password: Option<String>,
    role: Option<PermissionLevel>,
    #[serde(rename = "type")]
    kind: Option<UserType>,
    permissions: Option<Vec<String>>,
}

async fn create(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<User>), ApiError> {
    let name = accounts::validate_name(&body.name)?;
    let email = accounts::normalize_email(&body.email);
    accounts::validate_email(&email)?;
    let kind = body.kind.unwrap_or(UserType::Client);
    if kind == UserType::Superadmin && !admin.is_superadmin() {
        return Err(ApiError::Denied("only a superadmin can create a superadmin".into()));
    }
    let role = body.role.unwrap_or(PermissionLevel::Viewer);
    let permissions = checked_permissions(body.permissions, role)?;
    let invite = body.password.is_none();
    let password = match body.password {
        Some(password) => {
            accounts::check_policy(&password, state.settings.read(|s| s.security.password_policy))?;
            password
        }
        None => crate::auth::new_token().0,
    };
    let password_hash = accounts::hash_password(password).await?;
    let user = accounts::insert_user(
        &state.pool,
        NewUser {
            name: &name,
            email: &email,
            password_hash: &password_hash,
            status: UserStatus::Active,
            kind,
            role,
            permissions,
            // An admin vouches for the address; an invite proves it when the link is used.
            verified: !invite,
        },
    )
    .await?;
    if invite {
        send_password_link(&state, &user, "You've been invited to Tack", "Choose a password to sign in")
            .await?;
    }
    let metadata = json!({ "role": user.role, "type": user.kind, "invited": invite });
    audit::record(&state.pool, &admin, "user.created", format!("user:{}", user.id), metadata, Some(&meta))
        .await;
    Ok((StatusCode::CREATED, Json(user)))
}

/// Explicit permissions if valid, otherwise the role's defaults.
fn checked_permissions(
    permissions: Option<Vec<String>>,
    role: PermissionLevel,
) -> Result<Vec<String>, ApiError> {
    let Some(mut permissions) = permissions else {
        return Ok(role.default_permissions());
    };
    if let Some(bad) = permissions.iter().find(|p| !is_valid_permission(p)) {
        return Err(ApiError::BadRequest(format!("{bad:?} isn't a permission")));
    }
    permissions.sort();
    permissions.dedup();
    Ok(permissions)
}

async fn send_password_link(
    state: &AppState,
    user: &User,
    subject: &str,
    intro: &str,
) -> Result<(), ApiError> {
    let token = accounts::issue_one_time(&state.pool, user.id, OneTimeKind::ResetPassword).await?;
    let link = format!("{}/reset-password?token={token}", state.config.app_url);
    mail::send(
        &user.email,
        subject,
        &format!("Hi {},\n\n{intro}: {link}\n\nThis link works for an hour.\n", user.name),
    );
    Ok(())
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct SessionMetadata {
    ip: Option<String>,
    browser: Option<String>,
    device: Option<String>,
    locale: Option<String>,
}

/// Matches `Session` in the web client.
#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct Session {
    id: Uuid,
    user_id: Uuid,
    created_at: DateTime<Utc>,
    last_seen_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    #[sqlx(flatten)]
    metadata: SessionMetadata,
}

async fn load_sessions(state: &AppState, user_id: Uuid) -> sqlx::Result<Vec<Session>> {
    sqlx::query_as(
        "SELECT id, user_id, created_at, last_seen_at, expires_at, ip, browser, device, locale
         FROM user_sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserDetail {
    #[serde(flatten)]
    user: User,
    locked_until: Option<DateTime<Utc>>,
    failed_logins: i32,
    boards_owned: i64,
    sessions: Vec<Session>,
    recent_activity: Vec<super::logs::AuditLog>,
}

async fn find(state: &AppState, id: Uuid) -> Result<User, ApiError> {
    accounts::user_by_id(&state.pool, id).await?.ok_or(ApiError::NotFound)
}

async fn detail(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<UserDetail>, ApiError> {
    let user = find(&state, id).await?;
    let (locked_until, failed_logins, boards_owned): (Option<DateTime<Utc>>, i32, i64) = sqlx::query_as(
        "SELECT locked_until, failed_logins, (SELECT count(*) FROM boards WHERE owner_id = $1) FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    let recent_activity = sqlx::query_as(
        "SELECT id, actor, actor_id, action, resource, metadata, ip, created_at FROM audit_logs
         WHERE actor_id = $1 OR resource = $2 ORDER BY created_at DESC, id DESC LIMIT 20",
    )
    .bind(id)
    .bind(format!("user:{id}"))
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(UserDetail {
        sessions: load_sessions(&state, id).await?,
        user,
        locked_until: locked_until.filter(|t| *t > Utc::now()),
        failed_logins,
        boards_owned,
        recent_activity,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateBody {
    name: Option<String>,
    email: Option<String>,
    status: Option<UserStatus>,
    role: Option<PermissionLevel>,
    #[serde(rename = "type")]
    kind: Option<UserType>,
    /// Replaces the list. Changing the role without this resets it to the role's defaults.
    permissions: Option<Vec<String>>,
}

/// What a change does to the target's access.
#[derive(Clone, Copy)]
struct Change {
    /// Touches status, role, type or permissions. Nobody may do that to themselves.
    access: bool,
    /// Leaves the target no longer an active superadmin (if they were one).
    removes_superadmin: bool,
}

impl Change {
    const NONE: Self = Self { access: false, removes_superadmin: false };
    const REMOVE: Self = Self { access: true, removes_superadmin: true };
}

/// Refuses changes that would leave nobody able to run the server, or that an admin may not make.
async fn check_change(state: &AppState, admin: &User, target: &User, change: Change) -> Result<(), ApiError> {
    if target.is_superadmin() && !admin.is_superadmin() {
        return Err(ApiError::Denied("only a superadmin can change a superadmin".into()));
    }
    if change.access && target.id == admin.id {
        return Err(ApiError::Denied("you can't change your own status, role or type".into()));
    }
    if change.removes_superadmin && target.is_superadmin() && target.status == UserStatus::Active {
        let others: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM users WHERE type = 'superadmin' AND status = 'active' AND id <> $1",
        )
        .bind(target.id)
        .fetch_one(&state.pool)
        .await?;
        if others == 0 {
            return Err(ApiError::Conflict("this is the last active superadmin".into()));
        }
    }
    Ok(())
}

async fn update(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateBody>,
) -> Result<Json<User>, ApiError> {
    let target = find(&state, id).await?;
    let status_change = body.status.filter(|s| *s != target.status);
    let role_change = body.role.filter(|r| *r != target.role);
    let kind_change = body.kind.filter(|k| *k != target.kind);
    let change = Change {
        access: status_change.is_some()
            || role_change.is_some()
            || kind_change.is_some()
            || body.permissions.is_some(),
        removes_superadmin: status_change.is_some_and(|s| s != UserStatus::Active)
            || kind_change == Some(UserType::Client),
    };
    check_change(&state, &admin, &target, change).await?;
    if kind_change == Some(UserType::Superadmin) && !admin.is_superadmin() {
        return Err(ApiError::Denied("only a superadmin can make a superadmin".into()));
    }

    let name = body.name.as_deref().map(accounts::validate_name).transpose()?;
    let email = body.email.as_deref().map(accounts::normalize_email);
    if let Some(email) = &email {
        accounts::validate_email(email)?;
    }
    let role = role_change.unwrap_or(target.role);
    let permissions = match (body.permissions, role_change) {
        (Some(p), _) => Some(checked_permissions(Some(p), role)?),
        (None, Some(role)) => Some(role.default_permissions()),
        (None, None) => None,
    };

    let result = sqlx::query_as::<_, UserRow>(crate::db::audited(format!(
        "UPDATE users u SET name = COALESCE($2, u.name), email = COALESCE($3, u.email),
           status = COALESCE($4, u.status), role = COALESCE($5, u.role), type = COALESCE($6, u.type),
           permissions = COALESCE($7, u.permissions), updated_at = now()
         WHERE u.id = $1 RETURNING {USER_COLUMNS}"
    )))
    .bind(id)
    .bind(&name)
    .bind(&email)
    .bind(status_change.map(enum_str))
    .bind(role_change.map(enum_str))
    .bind(kind_change.map(enum_str))
    .bind(&permissions)
    .fetch_one(&state.pool)
    .await;
    let user = match result {
        Ok(row) => User::from(row),
        Err(sqlx::Error::Database(err)) if err.is_unique_violation() => {
            return Err(ApiError::Conflict("an account with that email already exists".into()));
        }
        Err(err) => return Err(err.into()),
    };
    if status_change.is_some_and(|s| s != UserStatus::Active) {
        accounts::revoke_sessions(&state.pool, id).await?;
    }
    let metadata = json!({
        "name": name, "email": email, "status": status_change, "role": role_change,
        "type": kind_change, "permissions": permissions,
    });
    audit::record(&state.pool, &admin, "user.updated", format!("user:{id}"), metadata, Some(&meta)).await;
    Ok(Json(user))
}

#[derive(Deserialize)]
struct RemoveParams {
    /// Erase the account instead of marking it deleted. Superadmins only.
    #[serde(default)]
    hard: bool,
}

/// Marks the account deleted and signs it out everywhere; `?hard=true` erases it. Boards it owns
/// are kept, without an owner.
async fn remove(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
    Query(p): Query<RemoveParams>,
) -> Result<StatusCode, ApiError> {
    let target = find(&state, id).await?;
    check_change(&state, &admin, &target, Change::REMOVE).await?;
    delete_user(&state, &admin, &target, p.hard, &meta).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_user(
    state: &AppState,
    admin: &User,
    target: &User,
    hard: bool,
    meta: &RequestMeta,
) -> Result<(), ApiError> {
    if hard {
        if !admin.is_superadmin() {
            return Err(ApiError::Denied("only a superadmin can erase an account".into()));
        }
        sqlx::query("DELETE FROM users WHERE id = $1").bind(target.id).execute(&state.pool).await?;
    } else {
        sqlx::query("UPDATE users SET status = 'deleted', updated_at = now() WHERE id = $1")
            .bind(target.id)
            .execute(&state.pool)
            .await?;
        accounts::revoke_sessions(&state.pool, target.id).await?;
    }
    let metadata = json!({ "email": target.email, "hard": hard });
    audit::record(&state.pool, admin, "user.deleted", format!("user:{}", target.id), metadata, Some(meta))
        .await;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum BulkAction {
    Activate,
    Suspend,
    Delete,
}

#[derive(Deserialize)]
struct BulkBody {
    ids: Vec<Uuid>,
    action: BulkAction,
}

#[derive(Serialize)]
struct BulkResult {
    updated: Vec<Uuid>,
    /// Accounts that weren't changed, and why.
    skipped: Vec<BulkSkip>,
}

#[derive(Serialize)]
struct BulkSkip {
    id: Uuid,
    reason: String,
}

/// Applies one action to the selected rows. Each account gets the same checks as on its own.
async fn bulk(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Json(body): Json<BulkBody>,
) -> Result<Json<BulkResult>, ApiError> {
    if body.ids.len() > 500 {
        return Err(ApiError::BadRequest("at most 500 accounts at a time".into()));
    }
    let mut result = BulkResult { updated: Vec::new(), skipped: Vec::new() };
    for id in body.ids {
        let outcome = async {
            let target = find(&state, id).await?;
            let disables = !matches!(body.action, BulkAction::Activate);
            let change = Change { access: true, removes_superadmin: disables };
            check_change(&state, &admin, &target, change).await?;
            match body.action {
                BulkAction::Delete => delete_user(&state, &admin, &target, false, &meta).await,
                BulkAction::Activate | BulkAction::Suspend => {
                    let status = if disables { UserStatus::Suspended } else { UserStatus::Active };
                    sqlx::query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1")
                        .bind(id)
                        .bind(enum_str(status))
                        .execute(&state.pool)
                        .await?;
                    if disables {
                        accounts::revoke_sessions(&state.pool, id).await?;
                    }
                    let metadata = json!({ "status": status, "bulk": true });
                    audit::record(
                        &state.pool,
                        &admin,
                        "user.updated",
                        format!("user:{id}"),
                        metadata,
                        Some(&meta),
                    )
                    .await;
                    Ok(())
                }
            }
        }
        .await;
        match outcome {
            Ok(()) => result.updated.push(id),
            Err(err @ ApiError::Db(_)) => return Err(err),
            Err(err) => result.skipped.push(BulkSkip { id, reason: err.to_string() }),
        }
    }
    Ok(Json(result))
}

async fn sessions(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<Session>>, ApiError> {
    find(&state, id).await?;
    Ok(Json(load_sessions(&state, id).await?))
}

async fn revoke_all(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let target = find(&state, id).await?;
    check_change(&state, &admin, &target, Change::NONE).await?;
    let count = accounts::revoke_sessions(&state.pool, id).await?;
    let metadata = json!({ "sessions": count });
    audit::record(&state.pool, &admin, "user.sessions_revoked", format!("user:{id}"), metadata, Some(&meta))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

async fn revoke_one(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path((id, session_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let target = find(&state, id).await?;
    check_change(&state, &admin, &target, Change::NONE).await?;
    let deleted = sqlx::query("DELETE FROM user_sessions WHERE id = $1 AND user_id = $2")
        .bind(session_id)
        .bind(id)
        .execute(&state.pool)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound);
    }
    let metadata = json!({ "session": session_id });
    audit::record(&state.pool, &admin, "user.session_revoked", format!("user:{id}"), metadata, Some(&meta))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

/// Emails the user a link to choose a new password. Their current password keeps working until
/// they do.
async fn send_reset(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let target = find(&state, id).await?;
    check_change(&state, &admin, &target, Change::NONE).await?;
    send_password_link(&state, &target, "Reset your password", "Choose a new password").await?;
    audit::record(
        &state.pool,
        &admin,
        "user.password_reset_sent",
        format!("user:{id}"),
        json!({}),
        Some(&meta),
    )
    .await;
    Ok(StatusCode::ACCEPTED)
}

/// Clears a lockout from too many failed sign-ins.
async fn unlock(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let target = find(&state, id).await?;
    check_change(&state, &admin, &target, Change::NONE).await?;
    sqlx::query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    audit::record(&state.pool, &admin, "user.unlocked", format!("user:{id}"), json!({}), Some(&meta)).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Turns off someone's two-factor sign-in, for a lost phone and no recovery codes. They're signed
/// out everywhere; if it's required for them, they set it up again when they next sign in.
async fn reset_two_factor(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let target = find(&state, id).await?;
    check_change(&state, &admin, &target, Change::NONE).await?;
    if !target.two_factor_enabled {
        return Err(ApiError::Conflict("two-factor sign-in is already off for this user".into()));
    }
    crate::accounts::two_factor::clear(&state.pool, id).await?;
    crate::accounts::revoke_sessions(&state.pool, id).await?;
    audit::record(&state.pool, &admin, "user.two_factor_reset", format!("user:{id}"), json!({}), Some(&meta))
        .await;
    Ok(StatusCode::NO_CONTENT)
}
