mod accounts;
mod admin;
mod api;
mod audit;
mod auth;
mod config;
mod db;
mod housekeeping;
mod mail;
mod request_meta;
mod room;
mod settings;
mod types;
mod ws;

use std::{net::SocketAddr, sync::Arc};

use axum::{
    Router,
    http::{Method, Request, header},
    routing::get,
    serve::ListenerExt,
};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

use crate::{config::Config, room::RoomRegistry, settings::SettingsStore};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub pool: PgPool,
    pub rooms: RoomRegistry,
    pub settings: SettingsStore,
    pub mailer: mail::Mailer,
    pub started_at: DateTime<Utc>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Local dev: pick up the repo's .env (searched upwards from the working directory).
    // Variables already set in the environment win, and a missing file is fine.
    let dotenv = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "tack=debug,tower_http=info".into()),
        )
        .init();

    match dotenv {
        Ok(path) => tracing::info!(path = %path.display(), "loaded .env"),
        Err(e) if e.not_found() => {}
        Err(e) => anyhow::bail!("couldn't read .env: {e}"),
    }

    let config = Arc::new(Config::from_env()?);
    let mailer = mail::Mailer::new(config.smtp_url.as_deref(), &config.mail_from)?;
    let pool = db::connect(&config.database_url).await?;
    tracing::info!("database ready");
    let settings = SettingsStore::load(&pool, &config).await?;
    accounts::bootstrap_superadmin(&pool, &config).await?;
    housekeeping::close_stale_connections(&pool).await?;
    housekeeping::spawn(pool.clone(), settings.clone());

    let state = AppState {
        config: config.clone(),
        pool: pool.clone(),
        rooms: RoomRegistry::new(pool, settings.clone()),
        settings: settings.clone(),
        mailer,
        started_at: Utc::now(),
    };

    // Origins come from the live platform settings, so admins can change them without a restart.
    let origins = settings.clone();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(move |origin, _| {
            origin.to_str().is_ok_and(|o| origins.is_origin_allowed(o))
        }))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    // Log the path only: the WebSocket URL carries the share token in its query string.
    let trace = TraceLayer::new_for_http().make_span_with(
        |req: &Request<_>| tracing::info_span!("http", method = %req.method(), path = %req.uri().path()),
    );

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/ws/boards/{board_id}", get(ws::upgrade))
        .merge(api::router())
        .merge(accounts::routes::router())
        .merge(admin::router())
        .layer(trace)
        .layer(cors)
        .with_state(state);

    // TCP_NODELAY: small sync frames must go out immediately, not wait on Nagle.
    let listener = tokio::net::TcpListener::bind(config.addr).await?.tap_io(|tcp| {
        if let Err(err) = tcp.set_nodelay(true) {
            tracing::warn!(%err, "failed to set TCP_NODELAY");
        }
    });
    tracing::info!(addr = %config.addr, origins = ?settings.read(|s| s.platform.allowed_origins.clone()), "tack listening");

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
