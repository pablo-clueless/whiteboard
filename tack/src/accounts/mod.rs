//! User accounts and signed-in sessions.
//!
//! A session is a bearer token like a share link: 32 random bytes handed out once, stored as its
//! SHA-256. Sessions slide: each use pushes the expiry out by the security settings' session
//! timeout.

mod password;
mod profile;
pub mod routes;
mod totp;
pub mod two_factor;

use axum::{
    extract::FromRequestParts,
    http::{HeaderMap, Method, header, request::Parts},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sqlx::PgPool;
use uuid::Uuid;

pub use password::{check_policy, hash_password, verify_password};

use crate::{
    AppState,
    api::ApiError,
    auth::{TokenHash, hash_token, new_token},
    request_meta::RequestMeta,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserStatus {
    Active,
    Deleted,
    Inactive,
    Pending,
    Suspended,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserType {
    Superadmin,
    Client,
}

/// Matches `PermissionLevel` in the web client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionLevel {
    Admin,
    Owner,
    Viewer,
}

pub const ADMIN_READ: &str = "admin:read";
pub const ADMIN_WRITE: &str = "admin:write";

impl PermissionLevel {
    pub fn default_permissions(self) -> Vec<String> {
        let names: &[&str] = match self {
            Self::Admin => &[ADMIN_READ, ADMIN_WRITE],
            Self::Owner => &["owner:read", "owner:write"],
            Self::Viewer => &["viewer:read"],
        };
        names.iter().map(|&p| p.to_owned()).collect()
    }
}

/// A permission is `<level>:<action>`, e.g. `admin:write`.
pub fn is_valid_permission(p: &str) -> bool {
    matches!(
        p.split_once(':'),
        Some(("admin" | "owner" | "viewer", "read" | "write"))
    )
}

/// The lowercase name of a unit enum variant, as serde writes it.
pub fn enum_str<T: Serialize>(value: T) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(s)) => s,
        _ => unreachable!("unit enum variants serialize as strings"),
    }
}

pub fn parse_enum<T: DeserializeOwned>(s: &str) -> Option<T> {
    serde_json::from_value(serde_json::Value::String(s.to_owned())).ok()
}

#[derive(Debug, Clone, Serialize)]
pub struct UserMetadata {
    pub ip: Option<String>,
    pub browser: Option<String>,
    pub locale: Option<String>,
}

/// A user as the API shows it. Matches `User` in the web client.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub status: UserStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(rename = "type")]
    pub kind: UserType,
    pub role: PermissionLevel,
    pub permissions: Vec<String>,
    pub metadata: UserMetadata,
    pub email_verified: bool,
    /// Signs in with a code from an authenticator app as well as the password.
    pub two_factor_enabled: bool,
    /// Gets an email when their password, email or two-factor sign-in changes, or they sign in
    /// from a new address.
    pub security_emails: bool,
    pub last_seen_at: Option<DateTime<Utc>>,
}

impl User {
    pub fn is_superadmin(&self) -> bool {
        self.kind == UserType::Superadmin
    }

    /// Can use the admin interface at all.
    pub fn is_admin(&self) -> bool {
        self.is_superadmin() || self.role == PermissionLevel::Admin
    }

    pub fn can(&self, permission: &str) -> bool {
        self.is_superadmin() || self.permissions.iter().any(|p| p == permission)
    }
}

/// Columns for [`UserRow`], with the users table aliased as `u`.
pub const USER_COLUMNS: &str = "u.id, u.name, u.email, u.status, u.type, u.role, u.permissions, \
    u.email_verified_at, u.totp_enabled_at, u.last_ip, u.last_browser, u.last_locale, u.last_seen_at, u.created_at, u.updated_at, \
    u.security_emails";

#[derive(Debug, sqlx::FromRow)]
pub struct UserRow {
    id: Uuid,
    name: String,
    email: String,
    status: String,
    #[sqlx(rename = "type")]
    kind: String,
    role: String,
    permissions: Vec<String>,
    email_verified_at: Option<DateTime<Utc>>,
    totp_enabled_at: Option<DateTime<Utc>>,
    last_ip: Option<String>,
    last_browser: Option<String>,
    last_locale: Option<String>,
    last_seen_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: Option<DateTime<Utc>>,
    security_emails: bool,
}

impl From<UserRow> for User {
    fn from(r: UserRow) -> Self {
        Self {
            id: r.id,
            name: r.name,
            email: r.email,
            // The table's CHECK constraints keep these parseable.
            status: parse_enum(&r.status).unwrap_or(UserStatus::Inactive),
            kind: parse_enum(&r.kind).unwrap_or(UserType::Client),
            role: parse_enum(&r.role).unwrap_or(PermissionLevel::Viewer),
            permissions: r.permissions,
            metadata: UserMetadata {
                ip: r.last_ip,
                browser: r.last_browser,
                locale: r.last_locale,
            },
            email_verified: r.email_verified_at.is_some(),
            two_factor_enabled: r.totp_enabled_at.is_some(),
            security_emails: r.security_emails,
            last_seen_at: r.last_seen_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

pub async fn user_by_id(pool: &PgPool, id: Uuid) -> sqlx::Result<Option<User>> {
    let row: Option<UserRow> = sqlx::query_as(crate::db::audited(format!(
        "SELECT {USER_COLUMNS} FROM users u WHERE u.id = $1"
    )))
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(User::from))
}

pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

pub fn validate_email(email: &str) -> Result<(), ApiError> {
    let valid = email.len() <= 254
        && !email.chars().any(char::is_whitespace)
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        });
    if valid {
        Ok(())
    } else {
        Err(ApiError::BadRequest("enter a valid email address".into()))
    }
}

pub fn validate_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(ApiError::BadRequest(
            "name must be 1 to 100 characters".into(),
        ));
    }
    Ok(name.to_owned())
}

pub struct NewUser<'a> {
    pub name: &'a str,
    pub email: &'a str,
    pub password_hash: &'a str,
    pub status: UserStatus,
    pub kind: UserType,
    pub role: PermissionLevel,
    pub permissions: Vec<String>,
    pub verified: bool,
}

/// Inserts a user. A taken email is a Conflict.
pub async fn insert_user(pool: &PgPool, new: NewUser<'_>) -> Result<User, ApiError> {
    let id = Uuid::new_v4();
    let result = sqlx::query(
        "INSERT INTO users (id, name, email, password_hash, status, type, role, permissions, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN now() END)",
    )
    .bind(id)
    .bind(new.name)
    .bind(new.email)
    .bind(new.password_hash)
    .bind(enum_str(new.status))
    .bind(enum_str(new.kind))
    .bind(enum_str(new.role))
    .bind(&new.permissions)
    .bind(new.verified)
    .execute(pool)
    .await;
    match result {
        Ok(_) => {}
        Err(sqlx::Error::Database(err)) if err.is_unique_violation() => {
            return Err(ApiError::Conflict(
                "an account with that email already exists".into(),
            ));
        }
        Err(err) => return Err(err.into()),
    }
    user_by_id(pool, id).await?.ok_or(ApiError::NotFound)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

/// Starts a session for a user and returns its token. The only time the token is visible.
pub async fn create_session(
    pool: &PgPool,
    user_id: Uuid,
    meta: &RequestMeta,
    timeout_minutes: u32,
) -> sqlx::Result<NewSession> {
    let (token, hash) = new_token();
    let expires_at: DateTime<Utc> = sqlx::query_scalar(
        "INSERT INTO user_sessions (id, user_id, token_hash, ip, browser, device, locale, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8))
         RETURNING expires_at",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(hash.as_slice())
    .bind(meta.ip.as_deref())
    .bind(meta.browser.as_str())
    .bind(meta.device.as_str())
    .bind(meta.locale.as_deref())
    .bind(timeout_minutes as i32)
    .fetch_one(pool)
    .await?;
    Ok(NewSession { token, expires_at })
}

#[derive(sqlx::FromRow)]
struct SessionUserRow {
    session_id: Uuid,
    #[sqlx(flatten)]
    user: UserRow,
}

/// The active user a session token belongs to, sliding the session's expiry forward.
pub async fn user_for_session(
    pool: &PgPool,
    token: &str,
    timeout_minutes: u32,
) -> sqlx::Result<Option<(Uuid, User)>> {
    let row: Option<SessionUserRow> = sqlx::query_as(crate::db::audited(format!(
        "UPDATE user_sessions s
         SET last_seen_at = now(), expires_at = now() + make_interval(mins => $2)
         FROM users u
         WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id AND u.status = 'active'
         RETURNING s.id AS session_id, {USER_COLUMNS}"
    )))
    .bind(hash_token(token).as_slice())
    .bind(timeout_minutes as i32)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| (r.session_id, r.user.into())))
}

pub async fn revoke_sessions(pool: &PgPool, user_id: Uuid) -> sqlx::Result<u64> {
    Ok(sqlx::query("DELETE FROM user_sessions WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?
        .rows_affected())
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    pub ip: Option<String>,
    pub browser: Option<String>,
    pub device: Option<String>,
    pub locale: Option<String>,
}

/// A signed-in session, without its token. Matches `UserSession` in the web client.
#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: Uuid,
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    #[sqlx(flatten)]
    pub metadata: SessionMetadata,
}

/// A user's unexpired sessions, most recently used first.
pub async fn load_sessions(pool: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<SessionInfo>> {
    sqlx::query_as(
        "SELECT id, user_id, created_at, last_seen_at, expires_at, ip, browser, device, locale
         FROM user_sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// Emails `user` that `what` happened to their account (e.g. "Your password was changed"), with
/// where from, unless they've turned these emails off. Goes to `to` instead of their address when
/// given: an email change warns the old address.
pub fn security_alert(state: &AppState, user: &User, what: &str, meta: Option<&RequestMeta>, to: Option<&str>) {
    if !user.security_emails {
        return;
    }
    let from = meta
        .map(|m| {
            let ip = m.ip.as_deref().unwrap_or("an unknown address");
            format!(" from {} on {} ({ip})", m.browser.as_str(), m.device.as_str())
        })
        .unwrap_or_default();
    let when = Utc::now().format("%-d %B %Y at %H:%M UTC");
    let reset = format!("{}/forgot-password", state.config.app_url);
    state.mailer.send(
        to.unwrap_or(&user.email),
        &format!("Security alert: {what}"),
        &format!(
            "Hi {},\n\n{what}{from}, on {when}.\n\nIf this was you, there's nothing to do. If it \
             wasn't, reset your password now: {reset}\n\nYou can turn these emails off in your \
             account settings.\n",
            user.name
        ),
    );
}

pub fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty())
}

/// The signed-in user, from `Authorization: Bearer <session token>`. 401 without one.
pub struct CurrentUser {
    pub user: User,
    pub session_id: Uuid,
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer(&parts.headers).ok_or(ApiError::Unauthorized)?;
        let timeout = state.settings.read(|s| s.security.session_timeout);
        let (session_id, user) = user_for_session(&state.pool, token, timeout)
            .await?
            .ok_or(ApiError::Unauthorized)?;
        Ok(Self { user, session_id })
    }
}

/// The signed-in user if the request carries a valid session token.
pub struct MaybeUser(pub Option<User>);

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let Some(token) = bearer(&parts.headers) else {
            return Ok(Self(None));
        };
        let timeout = state.settings.read(|s| s.security.session_timeout);
        Ok(Self(
            user_for_session(&state.pool, token, timeout)
                .await?
                .map(|(_, user)| user),
        ))
    }
}

/// A signed-in admin. Reads need `admin:read` and anything else `admin:write`; superadmins have
/// every permission.
pub struct AdminUser(pub User);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let CurrentUser { user, .. } = CurrentUser::from_request_parts(parts, state).await?;
        let needed = if matches!(parts.method, Method::GET | Method::HEAD) {
            ADMIN_READ
        } else {
            ADMIN_WRITE
        };
        admin_access(state, &user, needed)?;
        Ok(Self(user))
    }
}

/// Whether `user` may use the admin interface with `permission`: an admin with it, who has set up
/// two-factor sign-in if the security settings require that.
pub fn admin_access(state: &AppState, user: &User, permission: &str) -> Result<(), ApiError> {
    if !user.is_admin() || !user.can(permission) {
        return Err(ApiError::Denied("only admins can do that".into()));
    }
    if two_factor::required_for(state, user) && !user.two_factor_enabled {
        return Err(ApiError::TwoFactorRequired);
    }
    Ok(())
}

/// One-time tokens for email links, and the sign-in step between password and code.
#[derive(Debug, Clone, Copy)]
pub enum OneTimeKind {
    VerifyEmail,
    ResetPassword,
    TwoFactor,
}

impl OneTimeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::VerifyEmail => "verify_email",
            Self::ResetPassword => "reset_password",
            Self::TwoFactor => "two_factor",
        }
    }

    fn lifetime_minutes(self) -> i32 {
        match self {
            Self::VerifyEmail => 24 * 60,
            Self::ResetPassword => 60,
            Self::TwoFactor => 5,
        }
    }
}

/// Issues a token, replacing any earlier one of the same kind for the user.
pub async fn issue_one_time(
    pool: &PgPool,
    user_id: Uuid,
    kind: OneTimeKind,
) -> sqlx::Result<String> {
    let (token, hash): (String, TokenHash) = new_token();
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM auth_tokens WHERE user_id = $1 AND kind = $2")
        .bind(user_id)
        .bind(kind.as_str())
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4))",
    )
    .bind(hash.as_slice())
    .bind(user_id)
    .bind(kind.as_str())
    .bind(kind.lifetime_minutes())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(token)
}

/// Uses up a token, returning its user if it was valid and unexpired.
pub async fn consume_one_time(
    pool: &PgPool,
    token: &str,
    kind: OneTimeKind,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar(
        "DELETE FROM auth_tokens WHERE token_hash = $1 AND kind = $2 AND expires_at > now() RETURNING user_id",
    )
    .bind(hash_token(token).as_slice())
    .bind(kind.as_str())
    .fetch_optional(pool)
    .await
}

/// The user a token belongs to if it's valid, without using it up.
pub async fn peek_one_time(pool: &PgPool, token: &str, kind: OneTimeKind) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar(
        "SELECT user_id FROM auth_tokens WHERE token_hash = $1 AND kind = $2 AND expires_at > now()",
    )
    .bind(hash_token(token).as_slice())
    .bind(kind.as_str())
    .fetch_optional(pool)
    .await
}

/// Creates the superadmin from TACK_ADMIN_EMAIL / TACK_ADMIN_PASSWORD when there isn't one yet.
pub async fn bootstrap_superadmin(
    pool: &PgPool,
    config: &crate::config::Config,
) -> anyhow::Result<()> {
    let Some((email, password)) = &config.bootstrap_admin else {
        return Ok(());
    };
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users WHERE type = 'superadmin')")
            .fetch_one(pool)
            .await?;
    if exists {
        return Ok(());
    }
    let email = normalize_email(email);
    validate_email(&email)
        .map_err(|_| anyhow::anyhow!("TACK_ADMIN_EMAIL isn't a valid email address"))?;
    let password_hash = hash_password(password.clone())
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let user = insert_user(
        pool,
        NewUser {
            name: "Administrator",
            email: &email,
            password_hash: &password_hash,
            status: UserStatus::Active,
            kind: UserType::Superadmin,
            role: PermissionLevel::Admin,
            permissions: PermissionLevel::Admin.default_permissions(),
            verified: true,
        },
    )
    .await
    .map_err(|e| anyhow::anyhow!("couldn't create the superadmin: {e}"))?;
    crate::audit::record(
        pool,
        crate::audit::Actor::System,
        "user.bootstrap",
        format!("user:{}", user.id),
        serde_json::json!({}),
        None,
    )
    .await;
    tracing::info!(%email, "superadmin created");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permissions_and_emails() {
        assert!(is_valid_permission("admin:write"));
        assert!(!is_valid_permission("admin:delete"));
        assert!(!is_valid_permission("root"));
        assert!(validate_email("a@b.co").is_ok());
        assert!(validate_email("a b@c.co").is_err());
        assert!(validate_email("@c.co").is_err());
        assert!(validate_email("a@localhost").is_err());
        assert_eq!(enum_str(UserStatus::Suspended), "suspended");
        assert_eq!(
            parse_enum::<UserType>("superadmin"),
            Some(UserType::Superadmin)
        );
    }
}
