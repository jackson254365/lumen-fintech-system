# ============================================================================
# Lumen Fintech Production Dockerfile
# Lightweight, secure, multi-stage build running as non-root user
# ============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci --only=production

# Production runtime stage
FROM node:22-alpine

WORKDIR /app

# Set production environment
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/lumen.sqlite

# Create dedicated non-root user and persistent data volume
RUN addgroup -S lumen && adduser -S lumen -G lumen \
    && mkdir -p /app/data && chown -R lumen:lumen /app

COPY --from=builder /app/node_modules ./node_modules
COPY --chown=lumen:lumen . .

USER lumen

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/system/health || exit 1

CMD ["node", "server/index.js"]
