//! Sign-up, sign-in and account recovery: `/api/auth/*`, plus the public `/api/config`.

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::{
    CurrentUser, NewSession, NewUser, OneTimeKind, PermissionLevel, User, UserRow, UserStatus, UserType,
    check_policy, consume_one_time, create_session, enum_str, hash_password, insert_user, issue_one_time,
    normalize_email, revoke_sessions, user_by_id, validate_email, validate_name, verify_password,
};
use crate::{AppState, api::ApiError, audit, request_meta::RequestMeta};

/// How long an account stays locked after too many failed sign-ins.
const LOCKOUT_MINUTES: i32 = 15;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/config", get(public_config))
        .route("/api/auth/signup", post(signup))
        .route("/api/auth/signin", post(signin))
        .merge(super::two_factor::router())
        .route("/api/auth/signout", post(signout))
        .route("/api/auth/me", get(me).patch(super::profile::update_me))
        .merge(super::profile::router())
        .route("/api/auth/verify-email", post(verify_email))
        .route("/api/auth/resend-verification", post(resend_verification))
        .route("/api/auth/forgot-password", post(forgot_password))
        .route("/api/auth/reset-password", post(reset_password))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicConfig {
    maintenance_mode: bool,
    allow_new_users: bool,
    password_policy: crate::settings::PasswordPolicy,
    /// Admins must sign in with an authenticator code as well.
    two_factor_required: bool,
    board: crate::settings::BoardSettings,
    /// Flag id → enabled.
    feature_flags: std::collections::BTreeMap<String, bool>,
}

/// What the web client needs to know to hide or disable features. No secrets.
async fn public_config(State(state): State<AppState>) -> Result<Json<PublicConfig>, ApiError> {
    let flags: Vec<(String, bool)> =
        sqlx::query_as("SELECT id, enabled FROM feature_flags").fetch_all(&state.pool).await?;
    let s = state.settings.get();
    Ok(Json(PublicConfig {
        maintenance_mode: s.platform.maintenance_mode,
        allow_new_users: s.security.allow_new_users,
        password_policy: s.security.password_policy,
        two_factor_required: s.security.two_factor_authentication,
        board: s.board,
        feature_flags: flags.into_iter().collect(),
    }))
}

#[derive(Deserialize)]
struct SignupBody {
    name: String,
    email: String,
    password: String,
}

async fn signup(
    State(state): State<AppState>,
    meta: RequestMeta,
    Json(body): Json<SignupBody>,
) -> Result<(StatusCode, Json<User>), ApiError> {
    let security = state.settings.read(|s| s.security.clone());
    if !security.allow_new_users {
        return Err(ApiError::Denied("sign-ups are closed".into()));
    }
    let name = validate_name(&body.name)?;
    let email = normalize_email(&body.email);
    validate_email(&email)?;
    check_policy(&body.password, security.password_policy)?;

    let password_hash = hash_password(body.password).await?;
    let user = insert_user(
        &state.pool,
        NewUser {
            name: &name,
            email: &email,
            password_hash: &password_hash,
            status: UserStatus::Pending,
            kind: UserType::Client,
            role: PermissionLevel::Viewer,
            permissions: PermissionLevel::Viewer.default_permissions(),
            verified: false,
        },
    )
    .await?;
    send_verification(&state, &user).await?;
    audit::record(&state.pool, &user, "user.signup", format!("user:{}", user.id), json!({}), Some(&meta))
        .await;
    Ok((StatusCode::CREATED, Json(user)))
}

pub(super) async fn send_verification(state: &AppState, user: &User) -> Result<(), ApiError> {
    let token = issue_one_time(&state.pool, user.id, OneTimeKind::VerifyEmail).await?;
    let link = format!("{}/verify-email?token={token}", state.config.app_url);
    state.mailer.send(
        &user.email,
        "Verify your email",
        &format!("Hi {},\n\nConfirm your email: {link}\n", user.name),
    );
    Ok(())
}

#[derive(Deserialize)]
struct SigninBody {
    email: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SigninResponse {
    #[serde(flatten)]
    session: NewSession,
    user: User,
}

/// A right password: either signed in, or (with two-factor on) one step from it.
#[derive(Serialize)]
#[serde(untagged)]
enum SigninOutcome {
    SignedIn(Box<SigninResponse>),
    #[serde(rename_all = "camelCase")]
    TwoFactor {
        two_factor_required: bool,
        /// Sent back with the code to `/api/auth/signin/two-factor`. Lasts 5 minutes.
        challenge: String,
    },
}

#[derive(sqlx::FromRow)]
struct Credentials {
    id: Uuid,
    password_hash: String,
    status: String,
    failed_logins: i32,
    locked_until: Option<DateTime<Utc>>,
    totp_enabled_at: Option<DateTime<Utc>>,
}

/// Counts a failed sign-in (a wrong password or a wrong code) and locks the account once the
/// count reaches the limit, then starts counting again. Returns whether it locked.
pub(super) async fn record_failed_signin(
    state: &AppState,
    user_id: Uuid,
    failed_logins: i32,
    action: &str,
    meta: &RequestMeta,
) -> Result<bool, ApiError> {
    let max_attempts = state.settings.read(|s| s.security.max_login_attempts);
    let lock = failed_logins + 1 >= max_attempts as i32;
    sqlx::query(
        "UPDATE users SET failed_logins = CASE WHEN $2 THEN 0 ELSE failed_logins + 1 END,
           locked_until = CASE WHEN $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1",
    )
    .bind(user_id)
    .bind(lock)
    .bind(LOCKOUT_MINUTES)
    .execute(&state.pool)
    .await?;
    let resource = format!("user:{user_id}");
    audit::record(&state.pool, audit::Actor::Anonymous, action, resource, json!({ "locked": lock }), Some(meta))
        .await;
    Ok(lock)
}

async fn signin(
    State(state): State<AppState>,
    meta: RequestMeta,
    Json(body): Json<SigninBody>,
) -> Result<Json<SigninOutcome>, ApiError> {
    let email = normalize_email(&body.email);
    let creds: Option<Credentials> = sqlx::query_as(
        "SELECT id, password_hash, status, failed_logins, locked_until, totp_enabled_at FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(c) = &creds
        && c.locked_until.is_some_and(|until| until > Utc::now())
    {
        return Err(ApiError::TooManyAttempts);
    }
    let valid = verify_password(body.password, creds.as_ref().map(|c| c.password_hash.clone())).await;
    let creds = match creds {
        Some(c) if valid => c,
        unknown_or_wrong => {
            if let Some(c) = unknown_or_wrong {
                record_failed_signin(&state, c.id, c.failed_logins, "auth.signin_failed", &meta).await?;
            }
            return Err(ApiError::InvalidCredentials);
        }
    };

    match super::parse_enum(&creds.status) {
        Some(UserStatus::Active) => {}
        Some(UserStatus::Pending) => {
            return Err(ApiError::Denied("verify your email before signing in".into()));
        }
        _ => {
            return Err(ApiError::Denied(format!("this account is {}", creds.status)));
        }
    }

    if creds.totp_enabled_at.is_some() {
        let challenge = issue_one_time(&state.pool, creds.id, OneTimeKind::TwoFactor).await?;
        return Ok(Json(SigninOutcome::TwoFactor { two_factor_required: true, challenge }));
    }
    Ok(Json(SigninOutcome::SignedIn(Box::new(complete_signin(&state, creds.id, &meta).await?))))
}

/// Everything checked: clears the failed count, notes where they signed in from, and starts a
/// session.
pub(super) async fn complete_signin(
    state: &AppState,
    user_id: Uuid,
    meta: &RequestMeta,
) -> Result<SigninResponse, ApiError> {
    let security = state.settings.read(|s| s.security.clone());
    // Signed in before, but never from this address: worth telling them.
    let (signed_in_before, known_address): (bool, bool) = sqlx::query_as(
        "SELECT EXISTS (SELECT 1 FROM audit_logs WHERE actor_id = $1 AND action = 'auth.signin'),
                EXISTS (SELECT 1 FROM audit_logs WHERE actor_id = $1 AND action = 'auth.signin'
                          AND ip IS NOT DISTINCT FROM $2)",
    )
    .bind(user_id)
    .bind(meta.ip.as_deref())
    .fetch_one(&state.pool)
    .await?;
    let row: UserRow = sqlx::query_as(crate::db::audited(format!(
        "UPDATE users u SET failed_logins = 0, locked_until = NULL, last_ip = $2, last_browser = $3,
           last_locale = $4, last_seen_at = now()
         WHERE u.id = $1 RETURNING {}",
        super::USER_COLUMNS
    )))
    .bind(user_id)
    .bind(meta.ip.as_deref())
    .bind(meta.browser.as_str())
    .bind(meta.locale.as_deref())
    .fetch_one(&state.pool)
    .await?;
    let user = User::from(row);
    let session = create_session(&state.pool, user.id, meta, security.session_timeout).await?;
    if signed_in_before && !known_address {
        super::security_alert(state, &user, "Someone signed in to your account", Some(meta), None);
    }
    audit::record(&state.pool, &user, "auth.signin", format!("user:{}", user.id), json!({}), Some(meta))
        .await;
    Ok(SigninResponse { session, user })
}

async fn signout(
    State(state): State<AppState>,
    current: CurrentUser,
    meta: RequestMeta,
) -> Result<StatusCode, ApiError> {
    sqlx::query("DELETE FROM user_sessions WHERE id = $1")
        .bind(current.session_id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state.pool,
        &current.user,
        "auth.signout",
        format!("user:{}", current.user.id),
        json!({}),
        Some(&meta),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

async fn me(current: CurrentUser) -> Json<User> {
    Json(current.user)
}

#[derive(Deserialize)]
struct TokenBody {
    token: String,
}

async fn verify_email(
    State(state): State<AppState>,
    meta: RequestMeta,
    Json(body): Json<TokenBody>,
) -> Result<Json<User>, ApiError> {
    let user_id = consume_one_time(&state.pool, &body.token, OneTimeKind::VerifyEmail)
        .await?
        .ok_or_else(|| ApiError::BadRequest("this link is invalid or has expired".into()))?;
    sqlx::query(
        "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()),
           status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, updated_at = now()
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(&state.pool)
    .await?;
    let user = user_by_id(&state.pool, user_id).await?.ok_or(ApiError::NotFound)?;
    audit::record(
        &state.pool,
        &user,
        "user.email_verified",
        format!("user:{}", user.id),
        json!({}),
        Some(&meta),
    )
    .await;
    Ok(Json(user))
}

#[derive(Deserialize)]
struct EmailBody {
    email: String,
}

/// Always 202, so the response doesn't reveal whether the email has an account.
async fn resend_verification(
    State(state): State<AppState>,
    Json(body): Json<EmailBody>,
) -> Result<StatusCode, ApiError> {
    let id: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE email = $1 AND status = 'pending'")
        .bind(normalize_email(&body.email))
        .fetch_optional(&state.pool)
        .await?;
    if let Some(id) = id
        && let Some(user) = user_by_id(&state.pool, id).await?
    {
        send_verification(&state, &user).await?;
    }
    Ok(StatusCode::ACCEPTED)
}

/// Always 202, like resend_verification.
async fn forgot_password(
    State(state): State<AppState>,
    meta: RequestMeta,
    Json(body): Json<EmailBody>,
) -> Result<StatusCode, ApiError> {
    let user: Option<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, name, email FROM users WHERE email = $1 AND status IN ('active', 'pending')",
    )
    .bind(normalize_email(&body.email))
    .fetch_optional(&state.pool)
    .await?;
    if let Some((id, name, email)) = user {
        let token = issue_one_time(&state.pool, id, OneTimeKind::ResetPassword).await?;
        let link = format!("{}/reset-password?token={token}", state.config.app_url);
        state.mailer.send(
            &email,
            "Reset your password",
            &format!("Hi {name},\n\nChoose a new password: {link}\n\nThis link works for an hour.\n"),
        );
        audit::record(
            &state.pool,
            audit::Actor::Anonymous,
            "auth.password_reset_requested",
            format!("user:{id}"),
            json!({}),
            Some(&meta),
        )
        .await;
    }
    Ok(StatusCode::ACCEPTED)
}

#[derive(Deserialize)]
struct ResetBody {
    token: String,
    password: String,
}

/// Sets a new password and signs the user out everywhere.
async fn reset_password(
    State(state): State<AppState>,
    meta: RequestMeta,
    Json(body): Json<ResetBody>,
) -> Result<StatusCode, ApiError> {
    check_policy(&body.password, state.settings.read(|s| s.security.password_policy))?;
    let user_id = consume_one_time(&state.pool, &body.token, OneTimeKind::ResetPassword)
        .await?
        .ok_or_else(|| ApiError::BadRequest("this link is invalid or has expired".into()))?;
    let password_hash = hash_password(body.password).await?;
    // Following the emailed link proves the address, so a pending account becomes active.
    sqlx::query(
        "UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now(),
           email_verified_at = COALESCE(email_verified_at, now()),
           status = CASE WHEN status = 'pending' THEN $3 ELSE status END
         WHERE id = $1",
    )
    .bind(user_id)
    .bind(&password_hash)
    .bind(enum_str(UserStatus::Active))
    .execute(&state.pool)
    .await?;
    revoke_sessions(&state.pool, user_id).await?;
    let user = user_by_id(&state.pool, user_id).await?;
    if let Some(user) = &user {
        super::security_alert(&state, user, "Your password was reset", Some(&meta), None);
    }
    let resource = format!("user:{user_id}");
    audit::record(&state.pool, user.as_ref(), "auth.password_reset", resource, json!({}), Some(&meta)).await;
    Ok(StatusCode::NO_CONTENT)
}
