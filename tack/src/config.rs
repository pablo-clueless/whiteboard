use std::net::SocketAddr;

use anyhow::Context;

#[derive(Debug, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    /// Origins allowed to open a WebSocket or call the REST API.
    pub allowed_origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let addr = std::env::var("TACK_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8080".into())
            .parse()
            .context("TACK_ADDR must be a socket address")?;

        let allowed_origins = std::env::var("TACK_ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:3000".into())
            .split(',')
            .map(|s| s.trim().trim_end_matches('/').to_owned())
            .filter(|s| !s.is_empty())
            .collect();

        Ok(Self { addr, allowed_origins })
    }

    pub fn is_origin_allowed(&self, origin: &str) -> bool {
        self.allowed_origins.iter().any(|o| o == origin)
    }
}
