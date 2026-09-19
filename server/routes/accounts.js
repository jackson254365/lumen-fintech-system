// ============================================================================
// Accounts Routes
// Real-time balance derivation directly from double-entry postings
// ============================================================================
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { getAccountBalance, recordOpeningBalance } = require('../ledger/ledger-core');

const router = express.Router();

router.get('/', (req, res) => {
  const accounts = db.query(
    'SELECT id, name, type, account_class, currency, institution, initial_balance FROM accounts WHERE user_id = ? AND is_archived = 0 ORDER BY created_at ASC',
    [req.user.id]
  );

  const accountsWithBalances = accounts.map(acc => {
    const balance = getAccountBalance(acc.id);
    return {
      id: acc.id,
      name: acc.name,
      type: `${acc.type.charAt(0).toUpperCase() + acc.type.slice(1)} · ${acc.institution}`,
      rawType: acc.type,
      accountClass: acc.account_class,
      currency: acc.currency,
      institution: acc.institution,
      balance: Number(balance.toFixed(2))
    };
  });

  const totalBalance = accountsWithBalances
    .filter(a => a.accountClass === 'asset')
    .reduce((sum, a) => sum + a.balance, 0);

  res.json({
    success: true,
    totalBalance: Number(totalBalance.toFixed(2)),
    accounts: accountsWithBalances
  });
});

router.post('/', (req, res) => {
  const { name, type = 'checking', initialBalance = 0, institution = 'Lumen Bank' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Account name is required' });
  }

  const accountId = 'acc_' + crypto.randomBytes(6).toString('hex');
  const accountType = type.toLowerCase();
  const accountClass = accountType === 'credit' ? 'liability' : 'asset';
  const numericBalance = Number(initialBalance) || 0;

  db.transaction(() => {
    db.run(
      `INSERT INTO accounts (id, user_id, name, type, account_class, currency, institution, initial_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [accountId, req.user.id, name.trim(), accountType, accountClass, 'USD', institution.trim(), numericBalance]
    );

    if (numericBalance > 0) {
      recordOpeningBalance({
        userId: req.user.id,
        accountId,
        balance: numericBalance
      });
    }
  });

  const balance = getAccountBalance(accountId);

  res.status(201).json({
    success: true,
    account: {
      id: accountId,
      name: name.trim(),
      type: `${accountType.charAt(0).toUpperCase() + accountType.slice(1)} · ${institution.trim()}`,
      accountClass,
      balance: Number(balance.toFixed(2))
    },
    message: 'Account created successfully with double-entry opening equity'
  });
});

module.exports = router;
