//! Two-factor sign-in: setting up an authenticator app, recovery codes, and the code step of
//! signing in. Anyone can turn it on; the security setting `twoFactorAuthentication` makes it
//! required for admins (see [`super::admin_access`]).

use axum::{Json, Router, extract::State, routing::post};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    CurrentUser, OneTimeKind, User, consume_one_time, peek_one_time,
    routes::{SigninResponse, complete_signin, record_failed_signin},
    totp, user_by_id,
};
use crate::{AppState, api::ApiError, audit, auth::hash_token, request_meta::RequestMeta};

/// Shown as the account's name in authenticator apps.
const ISSUER: &str = "Tack";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/signin/two-factor", post(signin_code))
        .route("/api/auth/two-factor/setup", post(setup))
        .route("/api/auth/two-factor/enable", post(enable))
        .route("/api/auth/two-factor/disable", post(disable))
        .route("/api/auth/two-factor/recovery-codes", post(regenerate_codes))
}

/// The security settings require `user` to use two-factor sign-in.
pub fn required_for(state: &AppState, user: &User) -> bool {
    user.is_admin() && state.settings.read(|s| s.security.two_factor_authentication)
}

fn wrong_code() -> ApiError {
    ApiError::Invalid { field: "code", message: "That code isn't right. Try the newest one.".into() }
}

#[derive(sqlx::FromRow)]
struct TotpState {
    totp_secret: Option<Vec<u8>>,
    totp_enabled_at: Option<DateTime<Utc>>,
    totp_last_step: Option<i64>,
    failed_logins: i32,
    locked_until: Option<DateTime<Utc>>,
}

async fn totp_state(pool: &PgPool, user_id: Uuid) -> Result<TotpState, ApiError> {
    sqlx::query_as(
        "SELECT totp_secret, totp_enabled_at, totp_last_step, failed_logins, locked_until FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(ApiError::NotFound)
}

/// Checks an authenticator code against an enabled secret, recording the step so it can't be used
/// again. False for a wrong code.
async fn check_totp(pool: &PgPool, user_id: Uuid, state: &TotpState, code: &str) -> Result<bool, ApiError> {
    let (Some(secret), Some(_)) = (&state.totp_secret, state.totp_enabled_at) else {
        return Ok(false);
    };
    let Some(step) = totp::verify(secret, code, state.totp_last_step) else {
        return Ok(false);
    };
    // Conditional, so two requests racing with the same code can't both win.
    let updated = sqlx::query(
        "UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)",
    )
    .bind(user_id)
    .bind(step)
    .execute(pool)
    .await?;
    Ok(updated.rows_affected() == 1)
}

/// Uses up a recovery code. False if it isn't one of theirs or was used already.
async fn use_recovery_code(pool: &PgPool, user_id: Uuid, code: &str) -> Result<bool, ApiError> {
    let hash = hash_token(&totp::normalize_recovery_code(code));
    let used = sqlx::query(
        "UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL",
    )
    .bind(user_id)
    .bind(hash.as_slice())
    .execute(pool)
    .await?;
    Ok(used.rows_affected() == 1)
}

async fn remaining_codes(pool: &PgPool, user_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar("SELECT count(*) FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL")
        .bind(user_id)
        .fetch_one(pool)
        .await
}

/// Replaces the user's recovery codes with new ones, returned in the clear this once.
async fn new_recovery_codes(pool: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<String>> {
    let codes: Vec<String> = (0..totp::RECOVERY_CODES).map(|_| totp::new_recovery_code()).collect();
    let hashes: Vec<Vec<u8>> =
        codes.iter().map(|c| hash_token(&totp::normalize_recovery_code(c)).to_vec()).collect();
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM recovery_codes WHERE user_id = $1").bind(user_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO recovery_codes (user_id, code_hash) SELECT $1, unnest($2::bytea[])")
        .bind(user_id)
        .bind(&hashes)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(codes)
}

/// Turns two-factor sign-in off for a user and drops their recovery codes. Also used by admins.
pub async fn clear(pool: &PgPool, user_id: Uuid) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, updated_at = now() WHERE id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM recovery_codes WHERE user_id = $1").bind(user_id).execute(&mut *tx).await?;
    tx.commit().await
}

#[derive(Deserialize)]
struct SigninCodeBody {
    challenge: String,
    /// A code from the authenticator app, or a recovery code.
    code: String,
}

/// The second step of signing in. A wrong code counts as a failed sign-in, like a wrong password;
/// the challenge stays usable (for a typo) until it expires or the account locks.
async fn signin_code(
    State(state): State<AppState>,
    meta: RequestMeta,
    Json(body): Json<SigninCodeBody>,
) -> Result<Json<SigninResponse>, ApiError> {
    let expired = || ApiError::BadRequest("that sign-in took too long; enter your password again".into());
    let user_id =
        peek_one_time(&state.pool, &body.challenge, OneTimeKind::TwoFactor).await?.ok_or_else(expired)?;
    let current = totp_state(&state.pool, user_id).await?;
    if current.locked_until.is_some_and(|until| until > Utc::now()) {
        consume_one_time(&state.pool, &body.challenge, OneTimeKind::TwoFactor).await?;
        return Err(ApiError::TooManyAttempts);
    }

    let recovery = !totp::looks_like_code(&body.code);
    let valid = if recovery {
        current.totp_enabled_at.is_some() && use_recovery_code(&state.pool, user_id, &body.code).await?
    } else {
        check_totp(&state.pool, user_id, &current, &body.code).await?
    };
    if !valid {
        let locked =
            record_failed_signin(&state, user_id, current.failed_logins, "auth.two_factor_failed", &meta)
                .await?;
        if locked {
            consume_one_time(&state.pool, &body.challenge, OneTimeKind::TwoFactor).await?;
            return Err(ApiError::TooManyAttempts);
        }
        return Err(wrong_code());
    }

    // Used up only now, so a second request racing this one can't also sign in with it.
    consume_one_time(&state.pool, &body.challenge, OneTimeKind::TwoFactor).await?.ok_or_else(expired)?;
    if recovery {
        let remaining = remaining_codes(&state.pool, user_id).await?;
        audit::record(
            &state.pool,
            audit::Actor::Anonymous,
            "auth.recovery_code_used",
            format!("user:{user_id}"),
            json!({ "remaining": remaining }),
            Some(&meta),
        )
        .await;
    }
    Ok(Json(complete_signin(&state, user_id, &meta).await?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Setup {
    /// For typing into an app by hand: base32.
    secret: String,
    otpauth_url: String,
    /// The QR code of `otpauth_url`, as an SVG document.
    qr_svg: String,
}

/// Starts setting up an authenticator app: a new secret, which only counts once a code from it
/// is entered at `/enable`. Starting again replaces it.
async fn setup(State(state): State<AppState>, current: CurrentUser) -> Result<Json<Setup>, ApiError> {
    if current.user.two_factor_enabled {
        return Err(ApiError::Conflict("two-factor sign-in is already on".into()));
    }
    let secret = totp::new_secret();
    sqlx::query(
        "UPDATE users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1 AND totp_enabled_at IS NULL",
    )
    .bind(current.user.id)
    .bind(&secret)
    .execute(&state.pool)
    .await?;
    let otpauth_url = totp::otpauth_uri(ISSUER, &current.user.email, &secret);
    Ok(Json(Setup { secret: totp::encode_secret(&secret), qr_svg: totp::qr_svg(&otpauth_url), otpauth_url }))
}

#[derive(Deserialize)]
struct CodeBody {
    code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Enabled {
    /// Shown once; only their hashes are kept.
    recovery_codes: Vec<String>,
    user: User,
}

/// Finishes setup: a code from the new secret proves the app has it.
async fn enable(
    State(state): State<AppState>,
    current: CurrentUser,
    meta: RequestMeta,
    Json(body): Json<CodeBody>,
) -> Result<Json<Enabled>, ApiError> {
    let user_id = current.user.id;
    let pending = totp_state(&state.pool, user_id).await?;
    if pending.totp_enabled_at.is_some() {
        return Err(ApiError::Conflict("two-factor sign-in is already on".into()));
    }
    let secret = pending
        .totp_secret
        .ok_or_else(|| ApiError::BadRequest("start setting up two-factor sign-in first".into()))?;
    let step = totp::verify(&secret, &body.code, None).ok_or_else(wrong_code)?;
    sqlx::query(
        "UPDATE users SET totp_enabled_at = now(), totp_last_step = $2, updated_at = now()
         WHERE id = $1 AND totp_enabled_at IS NULL",
    )
    .bind(user_id)
    .bind(step)
    .execute(&state.pool)
    .await?;
    let recovery_codes = new_recovery_codes(&state.pool, user_id).await?;
    let user = user_by_id(&state.pool, user_id).await?.ok_or(ApiError::NotFound)?;
    super::security_alert(&state, &user, "Two-factor sign-in was turned on", Some(&meta), None);
    audit::record(
        &state.pool,
        &user,
        "auth.two_factor_enabled",
        format!("user:{user_id}"),
        json!({}),
        Some(&meta),
    )
    .await;
    Ok(Json(Enabled { recovery_codes, user }))
}

/// Checks a code (from the app, or a recovery code) for a signed-in user who's changing their
/// two-factor settings.
async fn confirm(state: &AppState, user_id: Uuid, code: &str) -> Result<(), ApiError> {
    let current = totp_state(&state.pool, user_id).await?;
    let valid = if totp::looks_like_code(code) {
        check_totp(&state.pool, user_id, &current, code).await?
    } else {
        use_recovery_code(&state.pool, user_id, code).await?
    };
    if valid { Ok(()) } else { Err(wrong_code()) }
}

async fn disable(
    State(state): State<AppState>,
    current: CurrentUser,
    meta: RequestMeta,
    Json(body): Json<CodeBody>,
) -> Result<Json<User>, ApiError> {
    let user = current.user;
    if !user.two_factor_enabled {
        return Err(ApiError::Conflict("two-factor sign-in is already off".into()));
    }
    if required_for(&state, &user) {
        return Err(ApiError::Denied("two-factor sign-in is required for admins".into()));
    }
    confirm(&state, user.id, &body.code).await?;
    clear(&state.pool, user.id).await?;
    super::security_alert(&state, &user, "Two-factor sign-in was turned off", Some(&meta), None);
    audit::record(
        &state.pool,
        &user,
        "auth.two_factor_disabled",
        format!("user:{}", user.id),
        json!({}),
        Some(&meta),
    )
    .await;
    Ok(Json(user_by_id(&state.pool, user.id).await?.ok_or(ApiError::NotFound)?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryCodes {
    recovery_codes: Vec<String>,
}

async fn regenerate_codes(
    State(state): State<AppState>,
    current: CurrentUser,
    meta: RequestMeta,
    Json(body): Json<CodeBody>,
) -> Result<Json<RecoveryCodes>, ApiError> {
    let user = current.user;
    if !user.two_factor_enabled {
        return Err(ApiError::Conflict("two-factor sign-in is off".into()));
    }
    if !totp::looks_like_code(&body.code) {
        return Err(ApiError::Invalid {
            field: "code",
            message: "Enter a code from your authenticator app".into(),
        });
    }
    confirm(&state, user.id, &body.code).await?;
    let recovery_codes = new_recovery_codes(&state.pool, user.id).await?;
    super::security_alert(&state, &user, "New recovery codes were made", Some(&meta), None);
    audit::record(
        &state.pool,
        &user,
        "auth.recovery_codes_regenerated",
        format!("user:{}", user.id),
        json!({}),
        Some(&meta),
    )
    .await;
    Ok(Json(RecoveryCodes { recovery_codes }))
}
