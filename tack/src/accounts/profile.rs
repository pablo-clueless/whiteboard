//! The signed-in user's own account: their name, email, password, email preferences and sessions.
//! Anyone signed in can use these; the admin's `/api/admin/users` is for changing other people.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::{
    CurrentUser, SessionInfo, USER_COLUMNS, User, UserRow, check_policy, hash_password, load_sessions,
    normalize_email, routes::send_verification, security_alert, validate_email, validate_name,
    verify_password,
};
use crate::{AppState, api::ApiError, audit, request_meta::RequestMeta};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/password", post(change_password))
        .route("/api/auth/me/verify-email", post(resend_my_verification))
        .route("/api/auth/sessions", get(sessions).delete(revoke_others))
        .route("/api/auth/sessions/{id}", delete(revoke_one))
}

fn wrong_password() -> ApiError {
    ApiError::Invalid { field: "currentPassword", message: "That isn't your current password.".into() }
}

/// Checks the signed-in user's password, for changes that need it.
async fn check_password(state: &AppState, user_id: Uuid, password: Option<String>) -> Result<(), ApiError> {
    let Some(password) = password.filter(|p| !p.is_empty()) else {
        return Err(ApiError::Invalid { field: "currentPassword", message: "Enter your current password.".into() });
    };
    let hash: Option<String> = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;
    if verify_password(password, hash).await { Ok(()) } else { Err(wrong_password()) }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UpdateMeBody {
    name: Option<String>,
    email: Option<String>,
    /// Needed to change the email.
    current_password: Option<String>,
    security_emails: Option<bool>,
}

/// `PATCH /api/auth/me`. A new email needs the password, isn't verified until its link is
/// followed, and the old address is told.
pub(super) async fn update_me(
    State(state): State<AppState>,
    current: CurrentUser,
    meta: RequestMeta,
    Json(body): Json<UpdateMeBody>,
) -> Result<Json<User>, ApiError> {
    let before = current.user;
    let name = body.name.as_deref().map(validate_name).transpose()?.filter(|n| *n != before.name);
    let email = body.email.as_deref().map(normalize_email).filter(|e| *e != before.email);
    if let Some(email) = &email {
        validate_email(email).map_err(|e| ApiError::Invalid { field: "email", message: e.to_string() })?;
        check_password(&state, before.id, body.current_password).await?;
    }
    let security_emails = body.security_emails.filter(|s| *s != before.security_emails);

    let result = sqlx::query_as::<_, UserRow>(crate::db::audited(format!(
        "UPDATE users u SET name = COALESCE($2, u.name), email = COALESCE($3, u.email),
           email_verified_at = CASE WHEN $3 IS NULL THEN u.email_verified_at END,
           security_emails = COALESCE($4, u.security_emails), updated_at = now()
         WHERE u.id = $1 RETURNING {USER_COLUMNS}"
    )))
    .bind(before.id)
    .bind(&name)
    .bind(&email)
    .bind(security_emails)
    .fetch_one(&state.pool)
    .await;
    let user = match result {
        Ok(row) => User::from(row),
        Err(sqlx::Error::Database(err)) if err.is_unique_violation() => {
            return Err(ApiError::Invalid {
                field: "email",
                message: "Another account already uses that email.".into(),
            });
        }
        Err(err) => return Err(err.into()),
    };
    if let Some(email) = &email {
        // Warn the old address, whatever the new account's setting: it may not be them.
        security_alert(&state, &before, &format!("Your email was changed to {email}"), Some(&meta), None);
        send_verification(&state, &user).await?;
    }
    let metadata = json!({ "name": name, "email": email, "securityEmails": security_emails });
    audit::record(&state.pool, &user, "user.profile_updated", format!("user:{}", user.id), metadata, Some(&meta))
        .await;
    Ok(Json(user))
}

/// Sends the signed-in user another link to verify their email.
async fn resend_my_verification(
    State(state): State<AppState>,
    current: CurrentUser,
) -> Result<StatusCode, ApiError> {
    if current.user.email_verified {
        return Err(ApiError::Conflict("your email is already verified".into()));
    }
    send_verification(&state, &current.user).await?;
    Ok(StatusCode::ACCEPTED)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasswordBody {
    current_password: Option<String>,
    new_password: String,
}

/// Changes the password and signs out every other session; this one stays signed in.
async fn change_password(
    State(state): State<AppState>,
    current: CurrentUser,
    meta: RequestMeta,
    Json(body): Json<PasswordBody>,
) -> Result<StatusCode, ApiError> {
    let user = current.user;
    check_password(&state, user.id, body.current_password).await?;
    check_policy(&body.new_password, state.settings.read(|s| s.security.password_policy))
        .map_err(|e| ApiError::Invalid { field: "newPassword", message: e.to_string() })?;
    let password_hash = hash_password(body.new_password).await?;
    sqlx::query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1")
        .bind(user.id)
        .bind(&password_hash)
        .execute(&state.pool)
        .await?;
    let signed_out = sqlx::query("DELETE FROM user_sessions WHERE user_id = $1 AND id <> $2")
        .bind(user.id)
        .bind(current.session_id)
        .execute(&state.pool)
        .await?
        .rows_affected();
    security_alert(&state, &user, "Your password was changed", Some(&meta), None);
    let metadata = json!({ "otherSessionsRevoked": signed_out });
    audit::record(&state.pool, &user, "auth.password_changed", format!("user:{}", user.id), metadata, Some(&meta))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

/// One of my sessions; `current` is the one making this request.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MySession {
    #[serde(flatten)]
    session: SessionInfo,
    current: bool,
}

async fn sessions(State(state): State<AppState>, current: CurrentUser) -> Result<Json<Vec<MySession>>, ApiError> {
    let sessions = load_sessions(&state.pool, current.user.id).await?;
    Ok(Json(
        sessions
            .into_iter()
            .map(|session| MySession { current: session.id == current.session_id, session })
            .collect(),
    ))
}

/// Signs out everywhere except here.
async fn revoke_others(
    State(state): State<AppState>,
    current: CurrentUser,
    meta: RequestMeta,
) -> Result<StatusCode, ApiError> {
    let count = sqlx::query("DELETE FROM user_sessions WHERE user_id = $1 AND id <> $2")
        .bind(current.user.id)
        .bind(current.session_id)
        .execute(&state.pool)
        .await?
        .rows_affected();
    let resource = format!("user:{}", current.user.id);
    audit::record(&state.pool, &current.user, "auth.other_sessions_revoked", resource, json!({ "sessions": count }), Some(&meta))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

/// Signs out one session. Signing out this one is what `/api/auth/signout` is for.
async fn revoke_one(
    State(state): State<AppState>,
    current: CurrentUser,
    meta: RequestMeta,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    if id == current.session_id {
        return Err(ApiError::BadRequest("that's this session: sign out instead".into()));
    }
    let deleted = sqlx::query("DELETE FROM user_sessions WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(current.user.id)
        .execute(&state.pool)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound);
    }
    let resource = format!("user:{}", current.user.id);
    audit::record(&state.pool, &current.user, "auth.session_revoked", resource, json!({ "session": id }), Some(&meta))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

