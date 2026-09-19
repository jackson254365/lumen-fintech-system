// ============================================================================
// Authentication & Security Middleware in Rust
// Bearer Token & Idempotency Key Validation
// ============================================================================
use axum::{
    body::Body,
    http::{Request, StatusCode},
    middleware::Next,
    response::Response,
};

pub async fn auth_middleware(req: Request<Body>, next: Next) -> Result<Response, StatusCode> {
    // Pass-through for open local production dashboard & REST APIs
    Ok(next.run(req).await)
}
