//! Runtime settings, edited from the admin interface.
//!
//! Each section is one JSON row in `settings`. They're loaded once at startup and cached; readers
//! never touch the database. A section that's missing or no longer parses falls back to defaults
//! (from the environment where there is one).

use std::sync::{Arc, RwLock};

use rand::RngCore;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sqlx::PgPool;

use crate::config::Config;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Platform {
    pub allowed_origins: Vec<String>,
    /// Seconds an empty room stays open before it saves and shuts down.
    pub idle_timeout: u64,
    /// Only admins can open boards or create them.
    pub maintenance_mode: bool,
    /// Largest board, in MB of encoded state.
    pub size_limit: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PasswordPolicy {
    /// At least 8 characters.
    Basic,
    /// At least 12 characters with a lowercase letter, an uppercase letter, a digit and a symbol.
    Strong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicy {
    /// Delete audit logs and connection records older than `retention_period`.
    pub automatic_deletion: bool,
    /// Days.
    pub retention_period: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Security {
    pub allow_new_users: bool,
    /// Failed sign-ins in a row before the account is locked for LOCKOUT_MINUTES.
    pub max_login_attempts: u32,
    pub password_policy: PasswordPolicy,
    pub retention_policy: RetentionPolicy,
    /// Minutes a session lasts without use.
    pub session_timeout: u32,
    /// Stored for the UI; not enforced yet.
    pub two_factor_authentication: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSettings {
    pub new_board_creation: bool,
    pub image_uploads: bool,
    /// Enforced by the web client (imports happen in the browser).
    pub diagram_import: bool,
    /// Enforced by the web client.
    pub read_only_switch: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Settings {
    pub platform: Platform,
    pub security: Security,
    pub board: BoardSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Section {
    Platform,
    Security,
    Board,
}

impl Section {
    fn key(self) -> &'static str {
        match self {
            Self::Platform => "platform",
            Self::Security => "security",
            Self::Board => "board",
        }
    }
}

const SALT_KEY: &str = "analytics_salt";

#[derive(Clone)]
pub struct SettingsStore {
    inner: Arc<RwLock<Settings>>,
    /// Salt for anonymous visitor ids, so they can't be matched against a list of IPs.
    salt: Arc<[u8; 32]>,
}

impl SettingsStore {
    pub async fn load(pool: &PgPool, config: &Config) -> anyhow::Result<Self> {
        let defaults = Settings::defaults(config);
        let rows: Vec<(String, serde_json::Value)> =
            sqlx::query_as("SELECT key, value FROM settings").fetch_all(pool).await?;
        let get = |key: &str| rows.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
        let settings = Settings {
            platform: section_or(get("platform"), defaults.platform),
            security: section_or(get("security"), defaults.security),
            board: section_or(get("board"), defaults.board),
        };

        let salt = match get(SALT_KEY).and_then(|v| v.as_str().and_then(crate::api::unhex)) {
            Some(salt) => salt,
            None => {
                let mut salt = [0u8; 32];
                rand::rng().fill_bytes(&mut salt);
                save(pool, SALT_KEY, &serde_json::json!(crate::api::hex(&salt))).await?;
                salt
            }
        };
        Ok(Self { inner: Arc::new(RwLock::new(settings)), salt: Arc::new(salt) })
    }

    pub fn get(&self) -> Settings {
        self.read(Clone::clone)
    }

    pub fn read<T>(&self, f: impl FnOnce(&Settings) -> T) -> T {
        f(&self.inner.read().unwrap_or_else(|e| e.into_inner()))
    }

    pub fn salt(&self) -> &[u8; 32] {
        &self.salt
    }

    pub fn is_origin_allowed(&self, origin: &str) -> bool {
        self.read(|s| s.platform.allowed_origins.iter().any(|o| o == origin))
    }

    pub fn max_board_bytes(&self) -> usize {
        self.read(|s| s.platform.size_limit as usize * 1024 * 1024)
    }

    pub fn idle_timeout(&self) -> std::time::Duration {
        self.read(|s| std::time::Duration::from_secs(s.platform.idle_timeout))
    }

    /// Merges `patch` (a partial section) into the current section, validates and saves it.
    /// Returns the new section, or why it was refused.
    pub async fn update(
        &self,
        pool: &PgPool,
        section: Section,
        patch: serde_json::Value,
    ) -> Result<serde_json::Value, UpdateError> {
        let current = self
            .read(|s| match section {
                Section::Platform => serde_json::to_value(&s.platform),
                Section::Security => serde_json::to_value(&s.security),
                Section::Board => serde_json::to_value(&s.board),
            })
            .expect("settings serialize");
        let mut merged = current;
        merge(&mut merged, patch);

        let invalid = |e: serde_json::Error| UpdateError::Invalid { field: None, message: e.to_string() };
        let mut next = self.get();
        match section {
            Section::Platform => {
                let mut platform: Platform = serde_json::from_value(merged.clone()).map_err(invalid)?;
                platform.allowed_origins = platform
                    .allowed_origins
                    .iter()
                    .map(|o| o.trim().trim_end_matches('/').to_owned())
                    .collect();
                platform.validate()?;
                merged = serde_json::to_value(&platform).expect("settings serialize");
                next.platform = platform;
            }
            Section::Security => {
                let security: Security = serde_json::from_value(merged.clone()).map_err(invalid)?;
                security.validate()?;
                next.security = security;
            }
            Section::Board => next.board = serde_json::from_value(merged.clone()).map_err(invalid)?,
        }
        save(pool, section.key(), &merged).await?;
        *self.inner.write().unwrap_or_else(|e| e.into_inner()) = next;
        Ok(merged)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    /// `field` is the setting at fault (`retentionPolicy.retentionPeriod`), when it's one.
    #[error("{message}")]
    Invalid { field: Option<&'static str>, message: String },
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

impl Settings {
    fn defaults(config: &Config) -> Self {
        Self {
            platform: Platform {
                allowed_origins: config.allowed_origins.clone(),
                idle_timeout: 60,
                maintenance_mode: false,
                size_limit: (config.max_board_bytes as u64).div_ceil(1024 * 1024).max(1),
            },
            security: Security {
                allow_new_users: true,
                max_login_attempts: 5,
                password_policy: PasswordPolicy::Basic,
                retention_policy: RetentionPolicy { automatic_deletion: false, retention_period: 90 },
                session_timeout: 60 * 24 * 7,
                two_factor_authentication: false,
            },
            board: BoardSettings {
                new_board_creation: true,
                image_uploads: true,
                diagram_import: true,
                read_only_switch: true,
            },
        }
    }
}

impl Platform {
    fn validate(&self) -> Result<(), UpdateError> {
        for origin in &self.allowed_origins {
            let valid = origin
                .strip_prefix("https://")
                .or_else(|| origin.strip_prefix("http://"))
                .is_some_and(|host| !host.is_empty() && !host.contains('/'));
            if !valid {
                return Err(UpdateError::Invalid {
                    field: Some("allowedOrigins"),
                    message: format!("{origin:?} isn't an origin like https://example.com"),
                });
            }
        }
        check_range("idleTimeout", self.idle_timeout, 5, 24 * 60 * 60)?;
        check_range("sizeLimit", self.size_limit, 1, 1024)
    }
}

impl Security {
    fn validate(&self) -> Result<(), UpdateError> {
        check_range("maxLoginAttempts", self.max_login_attempts.into(), 1, 100)?;
        check_range("sessionTimeout", self.session_timeout.into(), 5, 60 * 24 * 90)?;
        check_range("retentionPolicy.retentionPeriod", self.retention_policy.retention_period.into(), 1, 3650)
    }
}

fn check_range(field: &'static str, value: u64, min: u64, max: u64) -> Result<(), UpdateError> {
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(UpdateError::Invalid { field: Some(field), message: format!("Must be between {min} and {max}") })
    }
}

fn section_or<T: Serialize + DeserializeOwned>(stored: Option<serde_json::Value>, default: T) -> T {
    // Merge over the defaults so a field added later doesn't invalidate a stored section.
    let Some(stored) = stored else { return default };
    let mut value = serde_json::to_value(&default).expect("settings serialize");
    merge(&mut value, stored);
    serde_json::from_value(value).unwrap_or_else(|err| {
        tracing::warn!(%err, "stored settings section doesn't parse; using defaults");
        default
    })
}

/// JSON merge patch (RFC 7386): objects merge key by key, anything else replaces.
fn merge(target: &mut serde_json::Value, patch: serde_json::Value) {
    match (target, patch) {
        (serde_json::Value::Object(target), serde_json::Value::Object(patch)) => {
            for (key, value) in patch {
                if value.is_null() {
                    target.remove(&key);
                } else {
                    merge(target.entry(key).or_insert(serde_json::Value::Null), value);
                }
            }
        }
        (target, patch) => *target = patch,
    }
}

async fn save(pool: &PgPool, key: &str, value: &serde_json::Value) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_patches_nested_objects_and_replaces_the_rest() {
        let mut v = serde_json::json!({ "a": 1, "b": { "c": 2, "d": 3 }, "e": [1] });
        merge(&mut v, serde_json::json!({ "b": { "c": 5 }, "e": [2, 3] }));
        assert_eq!(v, serde_json::json!({ "a": 1, "b": { "c": 5, "d": 3 }, "e": [2, 3] }));
    }

    #[test]
    fn platform_rejects_bad_origins_and_ranges() {
        let mut p = Platform {
            allowed_origins: vec!["https://tack.example".into()],
            idle_timeout: 60,
            maintenance_mode: false,
            size_limit: 20,
        };
        assert!(p.validate().is_ok());
        p.allowed_origins.push("tack.example/x".into());
        assert!(p.validate().is_err());
        p.allowed_origins.pop();
        p.size_limit = 0;
        assert!(p.validate().is_err());
    }
}
