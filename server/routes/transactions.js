// ============================================================================
// Transactions Routes
// Double-entry money movement with strict balance validation & audit trail
// ============================================================================
const express = require('express');
const db = require('../db');
const { recordSpending, recordIncome, recordTransfer, getAccountBalance } = require('../ledger/ledger-core');
const { categorizeTransaction } = require('../statement-engine/categorizer');

const router = express.Router();

router.get('/', (req, res) => {
  const { type, accountId, category, search, limit = 100, offset = 0 } = req.query;

  let query = 'SELECT id, account_id, date, name, category, amount, type, icon, tone FROM transactions WHERE user_id = ?';
  const params = [req.user.id];

  if (type && type !== 'all') {
    query += ' AND type = ?';
    params.push(type);
  }

  if (accountId) {
    query += ' AND account_id = ?';
    params.push(accountId);
  }

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  if (search && search.trim()) {
    query += ' AND (name LIKE ? OR category LIKE ?)';
    const term = `%${search.trim()}%`;
    params.push(term, term);
  }

  query += ' ORDER BY date DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const transactions = db.query(query, params);

  // Stats for this month
  const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
  const stats = db.get(
    `SELECT
       SUM(CASE WHEN amount > 0 AND category != 'Internal transfer' THEN amount ELSE 0 END) as totalIncome,
       SUM(CASE WHEN amount < 0 AND category != 'Internal transfer' THEN ABS(amount) ELSE 0 END) as totalSpending
     FROM transactions
     WHERE user_id = ? AND strftime('%Y-%m', date) = ?`,
    [req.user.id, currentMonth]
  ) || { totalIncome: 0, totalSpending: 0 };

  res.json({
    success: true,
    totalIncome: Number((stats.totalIncome || 0).toFixed(2)),
    totalSpending: Number((stats.totalSpending || 0).toFixed(2)),
    availableToPlan: Number(((stats.totalIncome || 0) - (stats.totalSpending || 0)).toFixed(2)),
    transactions
  });
});

router.post('/', (req, res, next) => {
  try {
    const { accountId, amount, type = 'spending', category, description, note, date } = req.body;

    if (!accountId) {
      return res.status(400).json({ success: false, error: 'Account ID is required' });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be greater than 0' });
    }

    const payee = description || note || (type === 'income' ? 'Deposit' : 'Expense');
    const autoCat = categorizeTransaction(req.user.id, payee, type === 'income' ? Number(amount) : -Number(amount));
    const finalCategory = category || autoCat.category;
    const finalIcon = autoCat.icon;
    const finalTone = autoCat.tone;

    let result;
    if (type === 'income') {
      result = recordIncome({
        userId: req.user.id,
        accountId,
        amount: Number(amount),
        category: finalCategory,
        payee,
        date,
        icon: finalIcon,
        tone: finalTone
      });
    } else {
      result = recordSpending({
        userId: req.user.id,
        accountId,
        amount: Number(amount),
        category: finalCategory,
        payee,
        date,
        icon: finalIcon,
        tone: finalTone
      });
    }

    res.status(201).json({
      success: true,
      transaction: result,
      message: type === 'income' ? 'Income recorded successfully' : 'Spending recorded successfully'
    });
  } catch (err) {
    next(err);
  }
});

router.post('/transfer', (req, res, next) => {
  try {
    const { fromAccountId, toAccountId, amount, description, date } = req.body;

    if (!fromAccountId || !toAccountId) {
      return res.status(400).json({ success: false, error: 'Source and destination accounts are required' });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be greater than 0' });
    }

    const result = recordTransfer({
      userId: req.user.id,
      fromAccountId,
      toAccountId,
      amount: Number(amount),
      description: description || 'Internal transfer',
      date
    });

    res.status(201).json({
      success: true,
      transfer: result,
      message: 'Transfer completed successfully'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
