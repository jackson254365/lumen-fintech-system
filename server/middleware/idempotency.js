// ============================================================================
// Idempotency Middleware
// Intercepts mutating requests with 'Idempotency-Key' to prevent duplicate execution
// ============================================================================
const db = require('../db');

function idempotency(req, res, next) {
  // Only apply to mutating methods (POST, PUT, PATCH, DELETE)
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const key = req.headers['idempotency-key'];
  if (!key) {
    return next();
  }

  const userId = req.user?.id || 'system';

  // Check if key already exists and has not expired
  const existing = db.get(
    `SELECT response_code, response_body, expires_at
     FROM idempotency_keys
     WHERE key = ? AND user_id = ?`,
    [key, userId]
  );

  if (existing) {
    const isExpired = new Date(existing.expires_at) < new Date();
    if (!isExpired) {
      // Return cached response with custom idempotency replay header
      res.setHeader('X-Cache-Lookup', 'HIT-IDEMPOTENT');
      return res.status(existing.response_code).json(JSON.parse(existing.response_body));
    }
  }

  // Intercept res.json to capture response
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    // Only cache successful or client error responses (2xx, 4xx)
    if (res.statusCode < 500) {
      try {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        db.run(
          `INSERT OR REPLACE INTO idempotency_keys (key, user_id, endpoint, response_code, response_body, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [key, userId, req.originalUrl, res.statusCode, JSON.stringify(body), expiresAt]
        );
      } catch (err) {
        console.error('Failed to store idempotency key:', err.message);
      }
    }
    return originalJson(body);
  };

  next();
}

module.exports = {
  idempotency
};
