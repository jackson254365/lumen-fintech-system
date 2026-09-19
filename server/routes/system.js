// ============================================================================
// System Health, Diagnostics, and Ledger Data Export Routes
// ============================================================================
const express = require('express');
const fs = require('fs');
const config = require('../config');
const db = require('../db');
const { verifyAuditChain } = require('../ledger/audit-chain');

const router = express.Router();

router.get('/health', (req, res) => {
  let dbSizeBytes = 0;
  try {
    const stats = fs.statSync(config.DB_PATH);
    dbSizeBytes = stats.size;
  } catch (e) {}

  const entryCount = db.get('SELECT COUNT(*) as count FROM journal_entries')?.count || 0;
  const txCount = db.get('SELECT COUNT(*) as count FROM transactions')?.count || 0;
  const accountsCount = db.get('SELECT COUNT(*) as count FROM accounts')?.count || 0;

  res.json({
    status: 'healthy',
    system: 'Lumen Fintech Production Ledger Core',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMB: {
      rss: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      heapUsed: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1))
    },
    database: {
      engine: 'SQLite3 WAL Mode (ACID Compliant)',
      sizeKB: Number((dbSizeBytes / 1024).toFixed(1)),
      journalEntriesCount: entryCount,
      transactionsCount: txCount,
      accountsCount
    }
  });
});

router.post('/reset-demo', (req, res) => {
  const userId = req.user.id;

  db.transaction(() => {
    // Clear user data
    db.run('DELETE FROM postings WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE user_id = ?)', [userId]);
    db.run('DELETE FROM journal_entries WHERE user_id = ?', [userId]);
    db.run('DELETE FROM transactions WHERE user_id = ?', [userId]);
    db.run('DELETE FROM budgets WHERE user_id = ?', [userId]);
    db.run('DELETE FROM accounts WHERE user_id = ?', [userId]);

    // Re-seed default accounts and baseline ledger transactions
    const { seedDefaultAccounts } = require('../middleware/auth-guard');
    seedDefaultAccounts(userId);
  });

  res.json({
    success: true,
    message: 'Workspace successfully restored to production baseline demo data'
  });
});

router.get('/export', (req, res) => {
  const userId = req.user.id;

  const accounts = db.query('SELECT * FROM accounts WHERE user_id = ?', [userId]);
  const journals = db.query('SELECT * FROM journal_entries WHERE user_id = ? ORDER BY sequence_num ASC', [userId]);
  const postings = db.query(
    'SELECT p.* FROM postings p JOIN journal_entries j ON p.journal_entry_id = j.id WHERE j.user_id = ?',
    [userId]
  );
  const transactions = db.query('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [userId]);
  const budgets = db.query('SELECT * FROM budgets WHERE user_id = ?', [userId]);
  const auditVerification = verifyAuditChain(userId);

  const exportPayload = {
    system: 'Lumen Fintech Double-Entry Ledger Backup',
    exportedAt: new Date().toISOString(),
    user: { id: req.user.id, name: req.user.name, email: req.user.email },
    auditVerification,
    data: {
      accounts,
      journalEntries: journals,
      postings,
      transactions,
      budgets
    }
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="lumen-fintech-backup.json"');
  res.json(exportPayload);
});

module.exports = router;
