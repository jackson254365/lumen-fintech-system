// ============================================================================
// Lumen Finance Configuration
// ============================================================================
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'production',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../data/lumen.sqlite'),
  JWT_SECRET: process.env.JWT_SECRET || 'lumen-super-secure-production-fintech-jwt-secret-key-2026',
  SESSION_TTL_HOURS: 72,
  DEFAULT_CURRENCY: 'USD',
  SUPPORTED_CURRENCIES: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF'],
  HASH_GENESIS: 'GENESIS_LUMEN_FINTECH_CRYPTOGRAPHIC_LEDGER_CHAIN_2026',
  STATEMENT_UPLOAD_LIMIT_MB: 15,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};
