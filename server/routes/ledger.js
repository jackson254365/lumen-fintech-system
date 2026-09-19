// ============================================================================
// Double-Entry Ledger & Cryptographic Audit Routes
// ============================================================================
const express = require('express');
const db = require('../db');
const {
  createJournalEntry,
  getTrialBalance,
  getBalanceSheet,
  getIncomeStatement
} = require('../ledger/ledger-core');
const { verifyAuditChain } = require('../ledger/audit-chain');

const router = express.Router();

/**
 * Returns journal entries with their associated debit/credit postings
 */
router.get('/entries', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  const entries = db.query(
    `SELECT id, sequence_num, date, description, reference_id, prev_hash, entry_hash, created_at
     FROM journal_entries
     WHERE user_id = ?
     ORDER BY sequence_num DESC
     LIMIT ? OFFSET ?`,
    [req.user.id, Number(limit), Number(offset)]
  );

  const enriched = entries.map(e => {
    const postings = db.query(
      `SELECT id, account_id, account_code, direction, amount, currency
       FROM postings
       WHERE journal_entry_id = ?
       ORDER BY direction ASC, account_code ASC`,
      [e.id]
    );

    const totalDebits = postings
      .filter(p => p.direction === 'debit')
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      ...e,
      totalAmount: Number(totalDebits.toFixed(2)),
      postings
    };
  });

  res.json({
    success: true,
    entries: enriched
  });
});

/**
 * Trial Balance proving sum(Debits) === sum(Credits)
 */
router.get('/trial-balance', (req, res) => {
  const trialBalance = getTrialBalance(req.user.id);
  res.json({
    success: true,
    trialBalance
  });
});

/**
 * Balance Sheet (Assets = Liabilities + Equity)
 */
router.get('/balance-sheet', (req, res) => {
  const balanceSheet = getBalanceSheet(req.user.id);
  res.json({
    success: true,
    balanceSheet
  });
});

/**
 * Income Statement (Revenue - Expenses = Net Income)
 */
router.get('/income-statement', (req, res) => {
  const { fromDate, toDate } = req.query;
  const incomeStatement = getIncomeStatement(req.user.id, fromDate, toDate);
  res.json({
    success: true,
    incomeStatement
  });
});

/**
 * Cryptographic SHA-256 Audit Chain Verification
 * Verifies mathematical integrity of all blocks from genesis
 */
router.get('/verify-audit', (req, res) => {
  const auditResult = verifyAuditChain(req.user.id);
  res.json({
    success: true,
    audit: auditResult
  });
});

/**
 * Custom programmatic double-entry journal posting endpoint
 */
router.post('/entry', (req, res, next) => {
  try {
    const { date, description, referenceId, postings } = req.body;
    if (!description || !postings) {
      return res.status(400).json({ success: false, error: 'Description and postings array are required' });
    }

    const result = createJournalEntry({
      userId: req.user.id,
      date,
      description,
      referenceId,
      postings
    });

    res.status(201).json({
      success: true,
      journalEntry: result,
      message: 'Journal entry committed to ledger and hash chain'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
