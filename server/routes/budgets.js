// ============================================================================
// Budgets Routes
// Envelope budgeting with real-time monthly category spending aggregation
// ============================================================================
const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM

  const budgets = db.query(
    'SELECT id, name, category, monthly_limit, rollover FROM budgets WHERE user_id = ? ORDER BY created_at ASC',
    [req.user.id]
  );

  // Compute actual spent for each budget in current month
  const categorySpending = db.query(
    `SELECT category, SUM(ABS(amount)) as spent
     FROM transactions
     WHERE user_id = ? AND amount < 0 AND strftime('%Y-%m', date) = ?
     GROUP BY category`,
    [req.user.id, currentMonth]
  );

  const spendMap = {};
  for (const s of categorySpending) {
    spendMap[s.category] = s.spent;
  }

  const enrichedBudgets = budgets.map(b => {
    const spent = spendMap[b.category] || 0;
    const limit = b.monthly_limit;
    const percent = Math.min(100, Math.round((spent / limit) * 100));
    return {
      id: b.id,
      name: b.name,
      category: b.category,
      detail: getBudgetDetail(b.name),
      limit: Number(limit.toFixed(2)),
      spent: Number(spent.toFixed(2)),
      remaining: Number(Math.max(0, limit - spent).toFixed(2)),
      percent,
      isOverBudget: spent > limit
    };
  });

  const totalLimit = enrichedBudgets.reduce((sum, b) => sum + b.limit, 0);
  const totalSpent = enrichedBudgets.reduce((sum, b) => sum + b.spent, 0);

  res.json({
    success: true,
    totalLimit: Number(totalLimit.toFixed(2)),
    totalSpent: Number(totalSpent.toFixed(2)),
    budgets: enrichedBudgets
  });
});

router.post('/', (req, res) => {
  const { name, category, limit } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Budget name is required' });
  }
  const numericLimit = Number(limit);
  if (isNaN(numericLimit) || numericLimit <= 0) {
    return res.status(400).json({ success: false, error: 'Monthly limit must be greater than 0' });
  }

  const cat = (category || name).trim();
  const id = 'b_' + crypto.randomBytes(6).toString('hex');

  db.run(
    `INSERT INTO budgets (id, user_id, name, category, monthly_limit)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, category) DO UPDATE SET monthly_limit = excluded.monthly_limit, name = excluded.name`,
    [id, req.user.id, name.trim(), cat, numericLimit]
  );

  res.status(201).json({
    success: true,
    message: 'Budget created successfully',
    budget: {
      id,
      name: name.trim(),
      category: cat,
      limit: numericLimit,
      spent: 0
    }
  });
});

function getBudgetDetail(name) {
  const lower = name.toLowerCase();
  if (lower.includes('home')) return 'Rent, bills & utilities';
  if (lower.includes('food')) return 'Groceries and eating out';
  if (lower.includes('transport')) return 'Fuel, transit, and rides';
  if (lower.includes('fun')) return 'Guilt-free spending';
  return 'Monthly spending allocation';
}

module.exports = router;
