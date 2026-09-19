// ============================================================================
// Lumen Fintech Production Server Entrypoint
// Architecture: Node.js Express REST API + Double-Entry Ledger + Computational Research
// ============================================================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db');

const { authGuard, ensureDefaultUser } = require('./middleware/auth-guard');
const { idempotency } = require('./middleware/idempotency');
const { errorHandler } = require('./middleware/error-handler');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const budgetRoutes = require('./routes/budgets');
const ledgerRoutes = require('./routes/ledger');
const statementRoutes = require('./routes/statements');
const researchRoutes = require('./routes/research');
const systemRoutes = require('./routes/system');
const railsRoutes = require('./routes/rails');

const app = express();

// Initialize DB and ensure baseline user exists
db.getDb();
ensureDefaultUser();

// Global Middlewares
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security and performance headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Serve frontend static assets from project root
app.use(express.static(path.join(__dirname, '..')));

// Mount API routes with Auth Guard and Idempotency
app.use('/api', authGuard, idempotency);

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/statements', statementRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/rails', railsRoutes);
app.use('/api/system', systemRoutes);

// Centralized error handler
app.use(errorHandler);

// Fallback to index.html for client-side routing
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../index.html'));
  } else {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
  }
});

if (require.main === module) {
  app.listen(config.PORT, config.HOST, () => {
    console.log(`=======================================================`);
    console.log(`✨ Lumen Fintech Production Server running`);
    console.log(`🚀 URL: http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`);
    console.log(`📊 Research Hub & API: http://localhost:${config.PORT}/api/research/health-score`);
    console.log(`🔒 Cryptographic Ledger: http://localhost:${config.PORT}/api/ledger/verify-audit`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
