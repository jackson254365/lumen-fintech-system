// ============================================================================
// In-Memory Rate Limiter Middleware for Lumen Fintech System
// Protects financial endpoints from brute-force attacks and denial-of-service
// ============================================================================
use axum::{
    body::Body,
    http::{header::HeaderName, HeaderValue, Request, Response, StatusCode},
    middleware::Next,
    response::IntoResponse,
    Json,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
struct ClientRecord {
    count: u32,
    window_start: Instant,
}

#[derive(Clone)]
pub struct RateLimiter {
    clients: Arc<Mutex<HashMap<String, ClientRecord>>>,
    general_limit: u32,
    financial_limit: u32,
    window: Duration,
}

impl RateLimiter {
    pub fn new(general_limit: u32) -> Self {
        let financial_limit = (general_limit / 4).max(10);
        RateLimiter {
            clients: Arc::new(Mutex::new(HashMap::new())),
            general_limit,
            financial_limit,
            window: Duration::from_secs(60),
        }
    }

    /// Check if the request is allowed for the given key and path
    pub fn check(&self, key: &str, is_financial: bool) -> Result<(u32, u32), u64> {
        let max_requests = if is_financial {
            self.financial_limit
        } else {
            self.general_limit
        };

        let now = Instant::now();
        let mut map = self.clients.lock().unwrap();

        // Evict expired entries if map grows large (> 5000 entries)
        if map.len() > 5000 {
            map.retain(|_, v| now.duration_since(v.window_start) < self.window);
        }

        let record = map.entry(key.to_string()).or_insert_with(|| ClientRecord {
            count: 0,
            window_start: now,
        });

        let elapsed = now.duration_since(record.window_start);

        if elapsed >= self.window {
            // Window reset
            record.count = 1;
            record.window_start = now;
            let remaining = max_requests.saturating_sub(1);
            Ok((max_requests, remaining))
        } else if record.count >= max_requests {
            let retry_after = (self.window - elapsed).as_secs().max(1);
            Err(retry_after)
        } else {
            record.count += 1;
            let remaining = max_requests.saturating_sub(record.count);
            Ok((max_requests, remaining))
        }
    }
}

/// Rate limiting middleware function
pub async fn rate_limit_middleware(
    limiter: RateLimiter,
    req: Request<Body>,
    next: Next,
) -> Response<Body> {
    let path = req.uri().path().to_string();

    // Skip rate limiting for static assets and health check
    if path == "/api/system/health"
        || path == "/"
        || path == "/index.html"
        || path == "/app.js"
        || path == "/styles.css"
        || !path.starts_with("/api/")
    {
        return next.run(req).await;
    }

    // Determine client identifier: from CF-Connecting-IP, X-Forwarded-For, X-Real-IP, or default
    let client_ip = req
        .headers()
        .get("cf-connecting-ip")
        .or_else(|| req.headers().get("x-forwarded-for"))
        .or_else(|| req.headers().get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("127.0.0.1").trim().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let is_financial = path.starts_with("/api/rails/")
        || path.starts_with("/api/transactions")
        || path.starts_with("/api/statements/import");

    match limiter.check(&client_ip, is_financial) {
        Ok((limit, remaining)) => {
            let mut res = next.run(req).await;
            let headers = res.headers_mut();
            if let Ok(val) = HeaderValue::from_str(&limit.to_string()) {
                headers.insert(HeaderName::from_static("x-ratelimit-limit"), val);
            }
            if let Ok(val) = HeaderValue::from_str(&remaining.to_string()) {
                headers.insert(HeaderName::from_static("x-ratelimit-remaining"), val);
            }
            res
        }
        Err(retry_after) => {
            let body = json!({
                "error": "Rate limit exceeded",
                "message": format!("Too many requests. Please retry in {} seconds.", retry_after),
                "retry_after_seconds": retry_after,
                "status": 429
            });
            let mut response = (StatusCode::TOO_MANY_REQUESTS, Json(body)).into_response();
            let headers = response.headers_mut();
            if let Ok(val) = HeaderValue::from_str(&retry_after.to_string()) {
                headers.insert(HeaderName::from_static("retry-after"), val);
            }
            response
        }
    }
}
