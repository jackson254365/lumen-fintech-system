// ============================================================================
// Security Headers Middleware for Lumen Fintech System
// OWASP-compliant HTTP response security headers
// ============================================================================
use axum::{
    body::Body,
    http::{header, HeaderValue, Request, Response},
    middleware::Next,
};

/// Middleware to inject strict security headers on all HTTP responses
pub async fn security_headers_middleware(req: Request<Body>, next: Next) -> Response<Body> {
    let is_api = req.uri().path().starts_with("/api/");
    let mut response = next.run(req).await;

    let headers = response.headers_mut();

    // Prevent MIME-type sniffing
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );

    // Clickjacking protection - Deny framing
    headers.insert(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static("DENY"),
    );

    // Modern XSS Protection disabled in favor of CSP (standard best practice)
    headers.insert(
        header::X_XSS_PROTECTION,
        HeaderValue::from_static("0"),
    );

    // Referrer policy
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    // Permissions policy disabling unnecessary device APIs
    headers.insert(
        header::HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=(), payment=()"),
    );

    // Content Security Policy
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:;",
        ),
    );

    // For API responses, disable caching to prevent sensitive financial data leakage
    if is_api {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, no-cache, must-revalidate, private"),
        );
        headers.insert(
            header::PRAGMA,
            HeaderValue::from_static("no-cache"),
        );
    }

    response
}
