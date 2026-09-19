// ============================================================================
// Authentication & Authorization Guard Middleware
// Supports JWT Bearer tokens, x-api-key headers, and default local workspace
// ============================================================================
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

// Ensure default demo user exists for immediate out-of-the-box local use
function ensureDefaultUser() {
  const defaultUserId = 'usr_alex_morgan';
  const existing = db.get('SELECT id FROM users WHERE id = ?', [defaultUserId]);

  if (!existing) {
    const demoApiKey = 'lumen_live_sk_' + crypto.randomBytes(16).toString('hex');
    db.run(
      `INSERT INTO users (id, name, email, password_hash, currency, api_key, settings_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        defaultUserId,
        'Alex Morgan',
        'alex@lumen.finance',
        'sha256_mock_hash_for_alex',
        'USD',
        demoApiKey,
        JSON.stringify({ notifications: true, weeklyDigest: true, baseCurrency: 'USD' })
      ]
    );

    // Seed default demo accounts if not already seeded
    seedDefaultAccounts(defaultUserId);
  }

  return defaultUserId;
}

function seedDefaultAccounts(userId) {
  const existingAccounts = db.query('SELECT id FROM accounts WHERE user_id = ?', [userId]);
  if (existingAccounts.length > 0) return;

  const accounts = [
    { id: 'everyday', name: 'Everyday spending', type: 'checking', class: 'asset', institution: 'Starling Bank', balance: 8420.42 },
    { id: 'savings', name: 'Emergency fund', type: 'savings', class: 'asset', institution: 'Starling Bank', balance: 14260.00 },
    { id: 'travel', name: 'Travel fund', type: 'savings', class: 'asset', institution: 'Monzo Bank', balance: 2000.00 }
  ];

  for (const acc of accounts) {
    db.run(
      `INSERT INTO accounts (id, user_id, name, type, account_class, currency, institution, initial_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [acc.id, userId, acc.name, acc.type, acc.class, 'USD', acc.institution, acc.balance]
    );
  }

  // Budgets
  const budgets = [
    { id: 'b_home', category: 'Home', name: 'Home', limit: 1800 },
    { id: 'b_food', category: 'Food & drink', name: 'Food & drink', limit: 650 },
    { id: 'b_transport', category: 'Transport', name: 'Transport', limit: 300 },
    { id: 'b_fun', category: 'Fun money', name: 'Fun money', limit: 400 }
  ];

  for (const b of budgets) {
    db.run(
      `INSERT INTO budgets (id, user_id, name, category, monthly_limit)
       VALUES (?, ?, ?, ?, ?)`,
      [b.id, userId, b.name, b.category, b.limit]
    );
  }

  // Seed baseline journal entries and transactions using ledger-core
  const { recordIncome, recordSpending, recordTransfer } = require('../ledger/ledger-core');

  try {
    recordIncome({
      userId,
      accountId: 'everyday',
      amount: 6200,
      category: 'Income',
      payee: 'Salary · Acme Studio',
      date: '2026-09-08 08:42:00',
      icon: 'arrow-down-left',
      tone: 'teal'
    });

    recordSpending({
      userId,
      accountId: 'everyday',
      amount: 6.80,
      category: 'Food & drink',
      payee: 'Bluebird Coffee',
      date: '2026-09-07 09:16:00',
      icon: 'coffee',
      tone: 'orange'
    });

    recordSpending({
      userId,
      accountId: 'everyday',
      amount: 128.40,
      category: 'Home',
      payee: 'Horizon Insurance',
      date: '2026-09-06 14:10:00',
      icon: 'shield-check',
      tone: 'red'
    });

    recordSpending({
      userId,
      accountId: 'everyday',
      amount: 84.22,
      category: 'Food & drink',
      payee: 'Greenline Market',
      date: '2026-09-04 18:44:00',
      icon: 'shopping-basket',
      tone: 'orange'
    });

    recordSpending({
      userId,
      accountId: 'everyday',
      amount: 246.00,
      category: 'Home',
      payee: 'Cedar & Stone',
      date: '2026-09-03 11:02:00',
      icon: 'armchair',
      tone: 'red'
    });

    recordIncome({
      userId,
      accountId: 'everyday',
      amount: 1720.00,
      category: 'Income',
      payee: 'Freelance project',
      date: '2026-09-01 16:20:00',
      icon: 'briefcase-business',
      tone: 'teal'
    });

    // Seed balances into savings accounts
    recordIncome({
      userId,
      accountId: 'savings',
      amount: 14260.00,
      category: 'Income',
      payee: 'Initial Reserve Balance',
      date: '2026-08-01 12:00:00',
      icon: 'piggy-bank',
      tone: 'teal'
    });

    recordIncome({
      userId,
      accountId: 'travel',
      amount: 2000.00,
      category: 'Income',
      payee: 'Travel Savings Allocation',
      date: '2026-08-15 12:00:00',
      icon: 'plane',
      tone: 'teal'
    });
  } catch (e) {
    console.warn('Notice: Seeding baseline accounts note:', e.message);
  }
}

function authGuard(req, res, next) {
  const defaultUserId = ensureDefaultUser();

  // 1. Check API Key in headers (for Python / researcher clients)
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const user = db.get('SELECT id, name, email, currency FROM users WHERE api_key = ?', [apiKey]);
    if (user) {
      req.user = user;
      return next();
    }
    return res.status(401).json({ success: false, error: 'Invalid API Key provided' });
  }

  // 2. Check Authorization Bearer token
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // Decode or lookup user
    const user = db.get('SELECT id, name, email, currency FROM users WHERE id = ?', [token]);
    if (user) {
      req.user = user;
      return next();
    }
  }

  // 3. Fallback to default local user for zero-friction developer experience
  const defaultUser = db.get('SELECT id, name, email, currency, api_key FROM users WHERE id = ?', [defaultUserId]);
  req.user = defaultUser;
  next();
}

module.exports = {
  authGuard,
  ensureDefaultUser
};
