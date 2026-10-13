use std::net::SocketAddr;

use anyhow::Context;

#[derive(Debug, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    /// Origins allowed to open a WebSocket or call the REST API. The default for the platform
    /// settings; admins can change the live list.
    pub allowed_origins: Vec<String>,
    pub database_url: String,
    /// Boards stop accepting edits past roughly this many bytes of encoded state. The default for
    /// the platform settings.
    pub max_board_bytes: usize,
    /// Base URL of the web app, for links in emails.
    pub app_url: String,
    /// Take the client IP from `X-Forwarded-For`. Only behind a proxy that sets it.
    pub trust_proxy: bool,
    /// Storage budget reported by the health endpoint. Postgres has no notion of free space.
    pub storage_quota_bytes: Option<u64>,
    /// Creates this superadmin at startup if no superadmin exists yet.
    pub bootstrap_admin: Option<(String, String)>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let addr = std::env::var("TACK_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8080".into())
            .parse()
            .context("TACK_ADDR must be a socket address")?;

        let allowed_origins = std::env::var("TACK_ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:3000,http://localhost:3001".into())
            .split(',')
            .map(|s| s.trim().trim_end_matches('/').to_owned())
            .filter(|s| !s.is_empty())
            .collect();

        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://tack:tack@localhost:5434/tack".into());

        let max_board_bytes = match std::env::var("TACK_MAX_BOARD_BYTES") {
            Ok(v) => v.parse().context("TACK_MAX_BOARD_BYTES must be a number of bytes")?,
            Err(_) => 20 * 1024 * 1024,
        };

        let app_url = std::env::var("TACK_APP_URL")
            .unwrap_or_else(|_| "http://localhost:3001".into())
            .trim_end_matches('/')
            .to_owned();

        let trust_proxy = std::env::var("TACK_TRUST_PROXY").is_ok_and(|v| v == "1" || v == "true");

        let storage_quota_bytes = match std::env::var("TACK_STORAGE_QUOTA_BYTES") {
            Ok(v) => Some(v.parse().context("TACK_STORAGE_QUOTA_BYTES must be a number of bytes")?),
            Err(_) => None,
        };

        let bootstrap_admin = match (std::env::var("TACK_ADMIN_EMAIL"), std::env::var("TACK_ADMIN_PASSWORD"))
        {
            (Ok(email), Ok(password)) if !email.trim().is_empty() && !password.is_empty() => {
                Some((email, password))
            }
            _ => None,
        };

        Ok(Self {
            addr,
            allowed_origins,
            database_url,
            max_board_bytes,
            app_url,
            trust_proxy,
            storage_quota_bytes,
            bootstrap_admin,
        })
    }
}
