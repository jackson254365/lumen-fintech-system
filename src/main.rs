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
use routes::create_router;

use axum::http::HeaderValue;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("======================================================================");
    println!("⚡ Starting Lumen Fintech System Server (Rust Engine v1.0.0)");
    println!("======================================================================");

    let config = load_config();
    let pool = init_db(&config.database_url)?;

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // REST API routes
    let api_router = create_router(pool);

    // Serve static files (index.html, app.js, styles.css) with fallback
    let app = api_router
        .nest_service("/", ServeDir::new(".").fallback(ServeFile::new("index.html")))
        .layer(cors);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("Invalid host or port address configuration");

    println!("🚀 Lumen Rust Engine running at http://{}", addr);
    println!("🔗 GAAP/IFRS Ledger Engine & SHA-256 Audit Chain active");
    println!("🌐 Celo EVM Crypto & Multi-Rail Gateway active");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
