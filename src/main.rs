// ============================================================================
// Lumen Fintech System - Main Server Entrypoint (Rust / Axum / Tokio)
// High-performance double-entry financial backend and Web3 crypto engine
// ============================================================================
mod config;
mod db;
mod ledger;
mod middleware;
mod rails;
mod research_engine;
mod routes;
mod statement_engine;

use config::load_config;
use db::init_db;
use middleware::{
    auth_middleware, rate_limit_middleware, security_headers_middleware, AuthConfig, RateLimiter,
};
use routes::create_router;

use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize structured logging with RUST_LOG env filter
    // Defaults to INFO level. Override with RUST_LOG=debug for verbose output.
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("lumen_fintech_system=info,tower_http=info")),
        )
        .with_target(false)
        .with_level(true)
        .compact()
        .init();

    info!("======================================================================");
    info!("⚡  Lumen Fintech System — Rust Engine v1.0.0 (Axum + Tokio)");
    info!("======================================================================");

    let config = load_config();
    info!("📁  Database path: {}", config.database_url);

    let pool = init_db(&config.database_url)?;
    info!("🗄️   SQLite WAL pool initialized (max_size=16)");

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let rate_limiter = RateLimiter::new(config.rate_limit_per_minute);
    let auth_config = AuthConfig::new(config.api_key.clone());

    let rate_limiter_layer = rate_limiter.clone();
    let auth_config_layer = auth_config.clone();

    // REST API routes
    let api_router = create_router(pool, config.clone());

    // Serve static files (index.html, app.js, styles.css) with security middleware stack
    let app = api_router
        .nest_service("/", ServeDir::new(".").fallback(ServeFile::new("index.html")))
        .layer(axum::middleware::from_fn(move |req, next| {
            let auth = auth_config_layer.clone();
            async move { auth_middleware(auth, req, next).await }
        }))
        .layer(axum::middleware::from_fn(move |req, next| {
            let limiter = rate_limiter_layer.clone();
            async move { rate_limit_middleware(limiter, req, next).await }
        }))
        .layer(axum::middleware::from_fn(security_headers_middleware))
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("Invalid host or port address configuration");

    info!("🚀  Lumen Rust Engine running at http://{}", addr);
    info!("🔗  GAAP/IFRS Ledger Engine & SHA-256 Audit Chain active");
    info!("🛡️   Security Middleware active: OWASP headers, Rate Limiting, Idempotency Guard");
    info!("🌐  Celo EVM Crypto & Multi-Rail Gateway active");
    info!("🤖  Trading Bot Leverage Policy active: [{}x - {}x Corridor]", config.min_bot_leverage, config.max_bot_leverage);
    info!("======================================================================");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
