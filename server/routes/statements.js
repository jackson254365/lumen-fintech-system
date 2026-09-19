// ============================================================================
// Bank Statement Upload, Parsing, Deduplication, and Ingestion Routes
// ============================================================================
const express = require('express');
const multer = require('multer');
const { parseStatement } = require('../statement-engine/parser');
const { deduplicateTransactions } = require('../statement-engine/deduplicator');
const { categorizeTransaction } = require('../statement-engine/categorizer');
const { recordIncome, recordSpending } = require('../ledger/ledger-core');
const db = require('../db');

const upload = multer({
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  storage: multer.memoryStorage()
});

const router = express.Router();

/**
 * Upload & Preview: Parses CSV/OFX statement, detects duplicates, auto-categorizes
 */
router.post('/parse', upload.single('statement'), (req, res, next) => {
  try {
    const accountId = req.body.accountId;
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'Destination accountId is required' });
    }

    const account = db.get('SELECT id, name FROM accounts WHERE id = ? AND user_id = ?', [accountId, req.user.id]);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    let fileContent = '';
    let filename = '';

    if (req.file) {
      fileContent = req.file.buffer.toString('utf8');
      filename = req.file.originalname;
    } else if (req.body.csvContent) {
      fileContent = req.body.csvContent;
      filename = 'manual-input.csv';
    } else {
      return res.status(400).json({ success: false, error: 'No statement file or CSV content provided' });
    }

    // 1. Parse statement
    const parsedRows = parseStatement(fileContent, filename);

    // 2. Deduplicate against existing ledger transactions
    const dedupeResult = deduplicateTransactions(req.user.id, accountId, parsedRows);

    // 3. Auto-categorize non-duplicate transactions
    const categorized = dedupeResult.newTransactions.map(item => {
      const cat = categorizeTransaction(req.user.id, item.description, item.amount);
      return {
        ...item,
        category: item.category || cat.category,
        type: cat.type,
        icon: cat.icon,
        tone: cat.tone
      };
    });

    res.json({
      success: true,
      filename,
      account: { id: account.id, name: account.name },
      summary: {
        totalParsed: dedupeResult.totalParsed,
        newTransactionsCount: dedupeResult.newCount,
        duplicateCount: dedupeResult.duplicateCount
      },
      newTransactions: categorized,
      duplicates: dedupeResult.duplicateTransactions
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Commit: Posts approved transactions to the double-entry ledger
 */
router.post('/commit', (req, res, next) => {
  try {
    const { accountId, transactions } = req.body;
    if (!accountId || !Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ success: false, error: 'accountId and transactions array are required' });
    }

    const account = db.get('SELECT id, name, account_class FROM accounts WHERE id = ? AND user_id = ?', [accountId, req.user.id]);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    const committed = [];
    const errors = [];

    // Atomically commit batch to ledger
    db.transaction(() => {
      for (const t of transactions) {
        try {
          const numericAmount = Math.abs(Number(t.amount));
          if (t.amount > 0 || t.type === 'income') {
            const res = recordIncome({
              userId: req.user.id,
              accountId,
              amount: numericAmount,
              category: t.category || 'Income',
              payee: t.description,
              date: t.date,
              referenceId: t.referenceId || null,
              icon: t.icon || 'arrow-down-left',
              tone: t.tone || 'teal'
            });
            // Update fingerprint in cache
            if (t.fingerprint) {
              db.run('UPDATE transactions SET fingerprint = ? WHERE id = ?', [t.fingerprint, res.transactionId]);
            }
            committed.push(res);
          } else {
            const res = recordSpending({
              userId: req.user.id,
              accountId,
              amount: numericAmount,
              category: t.category || 'Other spending',
              payee: t.description,
              date: t.date,
              referenceId: t.referenceId || null,
              icon: t.icon || 'receipt-text',
              tone: t.tone || 'orange'
            });
            if (t.fingerprint) {
              db.run('UPDATE transactions SET fingerprint = ? WHERE id = ?', [t.fingerprint, res.transactionId]);
            }
            committed.push(res);
          }
        } catch (itemErr) {
          errors.push({ transaction: t, error: itemErr.message });
        }
      }
    });

    res.json({
      success: true,
      committedCount: committed.length,
      errorsCount: errors.length,
      committed,
      errors
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
