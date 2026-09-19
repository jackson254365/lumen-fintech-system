# ============================================================================
# Lumen Fintech Production Dockerfile (Rust Axum Engine)
# Multi-stage compilation using Rust official Alpine image
# ============================================================================
FROM rust:1.88-alpine AS builder

RUN apk add --no-coreutils musl-dev gcc sqlite-dev pkgconfig

WORKDIR /app

# Copy dependency manifests
COPY Cargo.toml Cargo.lock ./
COPY src ./src

# Build release binary
RUN cargo build --release --bin lumen-server

# Production runtime stage
FROM alpine:3.20

RUN apk add --no-cache libgcc sqlite-libs ca-certificates

WORKDIR /app

# Set production environment
ENV PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/lumen.sqlite \
    RUST_LOG=info

# Create dedicated non-root user and persistent data volume
RUN addgroup -S lumen && adduser -S lumen -G lumen \
    && mkdir -p /app/data && chown -R lumen:lumen /app

COPY --from=builder /app/target/release/lumen-server /app/lumen-server
COPY --chown=lumen:lumen index.html app.js styles.css ./

USER lumen

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/system/health || exit 1

CMD ["/app/lumen-server"]
