mod api;
mod auth;
mod config;
mod db;
mod room;
mod ws;

use std::sync::Arc;

use axum::{
    Router,
    http::{HeaderValue, Method, Request, header},
    routing::get,
    serve::ListenerExt,
};
use sqlx::PgPool;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::EnvFilter;

use crate::{config::Config, room::RoomRegistry};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub pool: PgPool,
    pub rooms: RoomRegistry,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "tack=debug,tower_http=info".into()),
        )
        .init();

    let config = Arc::new(Config::from_env()?);
    let pool = db::connect(&config.database_url).await?;
    tracing::info!("database ready");
    let state = AppState { config: config.clone(), pool: pool.clone(), rooms: RoomRegistry::new(pool, config.max_board_bytes) };

    let cors = CorsLayer::new()
        .allow_origin(
            config
                .allowed_origins
                .iter()
                .filter_map(|o| HeaderValue::from_str(o).ok())
                .collect::<Vec<_>>(),
        )
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    // Log the path only: the WebSocket URL carries the share token in its query string.
    let trace = TraceLayer::new_for_http().make_span_with(|req: &Request<_>| {
        tracing::info_span!("http", method = %req.method(), path = %req.uri().path())
    });

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/ws/boards/{board_id}", get(ws::upgrade))
        .merge(api::router())
        .layer(trace)
        .layer(cors)
        .with_state(state);

    // TCP_NODELAY: small sync frames must go out immediately, not wait on Nagle.
    let listener = tokio::net::TcpListener::bind(config.addr).await?.tap_io(|tcp| {
        if let Err(err) = tcp.set_nodelay(true) {
            tracing::warn!(%err, "failed to set TCP_NODELAY");
        }
    });
    tracing::info!(addr = %config.addr, origins = ?config.allowed_origins, "tack listening");

    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
