// ============================================================================
// Authentication, Idempotency & Security Middleware in Rust
// Timing-Attack-Resistant API Key validation & Idempotency Key deduplication
// ============================================================================
use axum::{
    body::Body,
    http::{Request, Response, StatusCode},
    middleware::Next,
    response::IntoResponse,
    Json,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// List of route prefixes that do NOT require API key authentication.
/// Web dashboard static assets, docs, and health checks are public.
const PUBLIC_PATHS: &[&str] = &[
    "/api/system/health",
    "/index.html",
    "/app.js",
    "/styles.css",
];

/// Idempotency Cache to prevent duplicate financial operations
#[derive(Clone)]
pub struct IdempotencyStore {
    seen_keys: Arc<Mutex<HashMap<String, Instant>>>,
    ttl: Duration,
}

impl IdempotencyStore {
    pub fn new() -> Self {
        IdempotencyStore {
            seen_keys: Arc::new(Mutex::new(HashMap::new())),
            ttl: Duration::from_secs(300), // 5 minute deduplication window
        }
    }

    /// Check and record an idempotency key. Returns true if key is new/fresh, false if already seen recently.
    pub fn check_and_record(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut map = self.seen_keys.lock().unwrap();

        // Evict expired keys periodically
        if map.len() > 1000 {
            map.retain(|_, v| now.duration_since(*v) < self.ttl);
        }

        if let Some(recorded_at) = map.get(key) {
            if now.duration_since(*recorded_at) < self.ttl {
                return false; // Duplicate detected
            }
        }

        map.insert(key.to_string(), now);
        true
    }
}

/// Constant-time byte slice comparison to prevent timing attacks
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}

#[derive(Clone)]
pub struct AuthConfig {
    pub required_api_key: Option<String>,
    pub idempotency_store: IdempotencyStore,
}

impl AuthConfig {
    pub fn new(required_api_key: Option<String>) -> Self {
        AuthConfig {
            required_api_key,
            idempotency_store: IdempotencyStore::new(),
        }
    }
}

/// Authentication & Idempotency Middleware
pub async fn auth_middleware(
    config: AuthConfig,
    req: Request<Body>,
    next: Next,
) -> Response<Body> {
    let path = req.uri().path().to_string();

    // Allow static assets, root path, and health check through without auth
    let is_public = path == "/"
        || PUBLIC_PATHS.iter().any(|p| path.starts_with(p))
        || !path.starts_with("/api/");

    if is_public {
        return next.run(req).await;
    }

    // 1. Validate API Key if one is configured in the environment
    if let Some(ref required_key) = config.required_api_key {
        let provided_key = req
            .headers()
            .get("x-api-key")
            .or_else(|| req.headers().get("authorization"))
            .and_then(|v| v.to_str().ok())
            .map(|s| {
                if s.to_lowercase().starts_with("bearer ") {
                    s[7..].trim().to_string()
                } else {
                    s.trim().to_string()
                }
            })
            .or_else(|| {
                req.uri().query().and_then(|q| {
                    q.split('&')
                        .find(|p| p.starts_with("api_key="))
                        .and_then(|p| p.split('=').nth(1))
                        .map(|v| v.to_string())
                })
            });

        match provided_key {
            Some(key) if constant_time_eq(key.as_bytes(), required_key.as_bytes()) => {
                // Key is valid, proceed
            }
            _ => {
                let err_res = json!({
                    "error": "Unauthorized",
                    "message": "Missing or invalid API key in 'X-API-Key' or 'Authorization: Bearer <token>' header.",
                    "status": 401
                });
                return (StatusCode::UNAUTHORIZED, Json(err_res)).into_response();
            }
        }
    }

    // 2. Check Idempotency Key on mutation endpoints (POST/PUT/DELETE)
    if req.method() == axum::http::Method::POST || req.method() == axum::http::Method::PUT {
        if let Some(idempotency_key) = req
            .headers()
            .get("x-idempotency-key")
            .or_else(|| req.headers().get("idempotency-key"))
            .and_then(|v| v.to_str().ok())
        {
            if !idempotency_key.trim().is_empty() {
                if !config.idempotency_store.check_and_record(idempotency_key.trim()) {
                    let err_res = json!({
                        "error": "Conflict",
                        "message": "Duplicate request detected with identical Idempotency-Key. Operation was already processed or is pending.",
                        "idempotency_key": idempotency_key,
                        "status": 409
                    });
                    return (StatusCode::CONFLICT, Json(err_res)).into_response();
                }
            }
        }
    }

    next.run(req).await
}
