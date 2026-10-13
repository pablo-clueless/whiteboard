//! The audit log: who did what to which resource. Writing an entry never fails the request that
//! caused it; a failed write is logged and dropped.

use sqlx::PgPool;
use uuid::Uuid;

use crate::{accounts::User, request_meta::RequestMeta};

/// Who an entry is attributed to.
pub enum Actor<'a> {
    User(&'a User),
    Anonymous,
    System,
}

impl<'a> From<&'a User> for Actor<'a> {
    fn from(user: &'a User) -> Self {
        Self::User(user)
    }
}

impl<'a> From<Option<&'a User>> for Actor<'a> {
    fn from(user: Option<&'a User>) -> Self {
        user.map_or(Self::Anonymous, Self::User)
    }
}

pub async fn record(
    pool: &PgPool,
    actor: impl Into<Actor<'_>>,
    action: &str,
    resource: impl AsRef<str>,
    metadata: serde_json::Value,
    meta: Option<&RequestMeta>,
) {
    let (actor_id, actor): (Option<Uuid>, &str) = match actor.into() {
        Actor::User(user) => (Some(user.id), &user.email),
        Actor::Anonymous => (None, "anonymous"),
        Actor::System => (None, "system"),
    };
    let result = sqlx::query(
        "INSERT INTO audit_logs (actor_id, actor, action, resource, metadata, ip) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(actor_id)
    .bind(actor)
    .bind(action)
    .bind(resource.as_ref())
    .bind(metadata)
    .bind(meta.and_then(|m| m.ip.as_deref()))
    .execute(pool)
    .await;
    if let Err(err) = result {
        tracing::error!(%err, action, "failed to write audit log");
    }
}
