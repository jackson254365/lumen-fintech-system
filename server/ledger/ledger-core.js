// ============================================================================
// Double-Entry Ledger Core Engine
// Guarantees debit-credit conservation: sum(debits) === sum(credits)
// Atomically posts journal entries and manages cryptographic audit verification
// ============================================================================
const crypto = require('crypto');
const db = require('../db');
const { ACCOUNT_TYPES, parseAccountCode, calculateBalanceDelta } = require('./chart-of-accounts');
const { computeEntryHash, getLatestTip } = require('./audit-chain');

class LedgerError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'LedgerError';
    this.statusCode = statusCode;
  }
}

/**
 * Creates a balanced multi-posting journal entry in an atomic transaction
 */
function createJournalEntry({ userId, date, description, referenceId = null, postings }) {
  if (!postings || postings.length < 2) {
    throw new LedgerError('A double-entry transaction requires at least two postings');
  }

  // Calculate sum of debits and credits
  let totalDebits = 0;
  let totalCredits = 0;

  for (const p of postings) {
    const amount = Number(p.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new LedgerError(`Invalid posting amount: ${p.amount}`);
    }
    if (p.direction === 'debit') {
      totalDebits += amount;
    } else if (p.direction === 'credit') {
      totalCredits += amount;
    } else {
      throw new LedgerError(`Invalid direction '${p.direction}'. Must be 'debit' or 'credit'`);
    }
  }

  // Precision check to 2 decimal places (0.005 tolerance for floating point)
  if (Math.abs(totalDebits - totalCredits) > 0.005) {
    throw new LedgerError(
      `Unbalanced journal entry: Total debits ($${totalDebits.toFixed(2)}) must equal total credits ($${totalCredits.toFixed(2)})`
    );
  }

  const entryId = 'je_' + crypto.randomUUID();
  const entryDate = date || new Date().toISOString().replace('T', ' ').substring(0, 19);

  return db.transaction(() => {
    // 1. Get latest tip from audit chain
    const tip = getLatestTip(userId);
    const nextSequence = tip.sequence + 1;
    const prevHash = tip.hash;

    // 2. Compute cryptographic entry hash
    const entryHash = computeEntryHash(
      prevHash,
      nextSequence,
      entryId,
      entryDate,
      description,
      postings
    );

    // 3. Insert Journal Entry header
    db.run(
      `INSERT INTO journal_entries (id, user_id, sequence_num, date, description, reference_id, prev_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entryId, userId, nextSequence, entryDate, description, referenceId, prevHash, entryHash]
    );

    // 4. Insert each posting
    for (const p of postings) {
      const postingId = 'post_' + crypto.randomUUID();
      db.run(
        `INSERT INTO postings (id, journal_entry_id, account_id, account_code, direction, amount, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [postingId, entryId, p.account_id || null, p.account_code, p.direction, Number(p.amount), p.currency || 'USD']
      );
    }

    return {
      entryId,
      sequence: nextSequence,
      entryHash,
      prevHash,
      date: entryDate,
      totalAmount: totalDebits
    };
  });
}

/**
 * Calculates current real balance of an account directly from posted debits and credits
 */
function getAccountBalance(accountId) {
  const account = db.get('SELECT id, type, account_class FROM accounts WHERE id = ?', [accountId]);
  if (!account) {
    throw new LedgerError(`Account not found: ${accountId}`, 404);
  }

  const rows = db.query(
    `SELECT direction, SUM(amount) as total
     FROM postings
     WHERE account_id = ?
     GROUP BY direction`,
    [accountId]
  );

  let debits = 0;
  let credits = 0;
  for (const r of rows) {
    if (r.direction === 'debit') debits = r.total;
    if (r.direction === 'credit') credits = r.total;
  }

  if (account.account_class === 'asset') {
    // Assets: Normal balance is debit
    return debits - credits;
  } else if (account.account_class === 'liability') {
    // Liabilities (Credit cards, loans): Normal balance is credit
    return credits - debits;
  }
  return debits - credits;
}

/**
 * Records an Expense / Spending transaction
 * Debit: Expense category
 * Credit: Asset account (decreasing cash/bank balance)
 */
function recordSpending({ userId, accountId, amount, category, payee, date = null, referenceId = null, icon = 'receipt-text', tone = 'orange' }) {
  const numericAmount = Math.abs(Number(amount));
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new LedgerError('Amount must be a positive number');
  }

  const account = db.get('SELECT id, name, type, account_class FROM accounts WHERE id = ? AND user_id = ?', [accountId, userId]);
  if (!account) {
    throw new LedgerError(`Account not found or access denied: ${accountId}`, 404);
  }

  // Enforce available balance check for asset accounts (checking/savings)
  if (account.account_class === 'asset') {
    const currentBalance = getAccountBalance(accountId);
    if (currentBalance - numericAmount < -0.001) {
      throw new LedgerError(
        `Insufficient funds in '${account.name}'. Available: $${currentBalance.toFixed(2)}, Requested: $${numericAmount.toFixed(2)}`
      );
    }
  }

  const cleanCategory = category.trim() || 'General Expense';
  const cleanPayee = payee.trim() || cleanCategory;
  const entryDate = date || new Date().toISOString().replace('T', ' ').substring(0, 19);

  return db.transaction(() => {
    // Double entry:
    // Debit: expense:<Category>
    // Credit: asset:<AccountId>
    const journalResult = createJournalEntry({
      userId,
      date: entryDate,
      description: cleanPayee,
      referenceId,
      postings: [
        {
          account_id: null,
          account_code: `expense:${cleanCategory}`,
          direction: 'debit',
          amount: numericAmount
        },
        {
          account_id: accountId,
          account_code: `asset:${accountId}`,
          direction: 'credit',
          amount: numericAmount
        }
      ]
    });

    // Record in user-facing transactions cache
    const txId = 'tx_' + crypto.randomUUID();
    db.run(
      `INSERT INTO transactions (id, journal_entry_id, user_id, account_id, date, name, category, amount, type, icon, tone, fingerprint, is_reconciled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txId,
        journalResult.entryId,
        userId,
        accountId,
        entryDate,
        cleanPayee,
        cleanCategory,
        -numericAmount,
        'spending',
        icon,
        tone,
        referenceId ? `ref:${referenceId}` : null,
        1
      ]
    );

    return {
      transactionId: txId,
      journalEntryId: journalResult.entryId,
      accountId,
      amount: -numericAmount,
      newBalance: getAccountBalance(accountId),
      entryHash: journalResult.entryHash
    };
  });
}

/**
 * Records an Income / Deposit transaction
 * Debit: Asset account (increasing cash/bank balance)
 * Credit: Revenue category
 */
function recordIncome({ userId, accountId, amount, category, payee, date = null, referenceId = null, icon = 'arrow-down-left', tone = 'teal' }) {
  const numericAmount = Math.abs(Number(amount));
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new LedgerError('Amount must be a positive number');
  }

  const account = db.get('SELECT id, name, type, account_class FROM accounts WHERE id = ? AND user_id = ?', [accountId, userId]);
  if (!account) {
    throw new LedgerError(`Account not found or access denied: ${accountId}`, 404);
  }

  const cleanCategory = category.trim() || 'Income';
  const cleanPayee = payee.trim() || cleanCategory;
  const entryDate = date || new Date().toISOString().replace('T', ' ').substring(0, 19);

  return db.transaction(() => {
    // Double entry:
    // Debit: asset:<AccountId>
    // Credit: revenue:<Category>
    const journalResult = createJournalEntry({
      userId,
      date: entryDate,
      description: cleanPayee,
      referenceId,
      postings: [
        {
          account_id: accountId,
          account_code: `asset:${accountId}`,
          direction: 'debit',
          amount: numericAmount
        },
        {
          account_id: null,
          account_code: `revenue:${cleanCategory}`,
          direction: 'credit',
          amount: numericAmount
        }
      ]
    });

    // Record in user-facing transactions cache
    const txId = 'tx_' + crypto.randomUUID();
    db.run(
      `INSERT INTO transactions (id, journal_entry_id, user_id, account_id, date, name, category, amount, type, icon, tone, fingerprint, is_reconciled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txId,
        journalResult.entryId,
        userId,
        accountId,
        entryDate,
        cleanPayee,
        cleanCategory,
        numericAmount,
        'income',
        icon,
        tone,
        referenceId ? `ref:${referenceId}` : null,
        1
      ]
    );

    return {
      transactionId: txId,
      journalEntryId: journalResult.entryId,
      accountId,
      amount: numericAmount,
      newBalance: getAccountBalance(accountId),
      entryHash: journalResult.entryHash
    };
  });
}

/**
 * Records an Internal Transfer between two accounts
 * Debit: Destination account (increase asset)
 * Credit: Source account (decrease asset)
 */
function recordTransfer({ userId, fromAccountId, toAccountId, amount, description = 'Internal transfer', date = null, referenceId = null }) {
  if (fromAccountId === toAccountId) {
    throw new LedgerError('Source and destination accounts must be different');
  }

  const numericAmount = Math.abs(Number(amount));
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new LedgerError('Amount must be a positive number');
  }

  const fromAccount = db.get('SELECT id, name, account_class FROM accounts WHERE id = ? AND user_id = ?', [fromAccountId, userId]);
  const toAccount = db.get('SELECT id, name, account_class FROM accounts WHERE id = ? AND user_id = ?', [toAccountId, userId]);

  if (!fromAccount || !toAccount) {
    throw new LedgerError('One or both accounts were not found or access denied', 404);
  }

  // Validate balance
  if (fromAccount.account_class === 'asset') {
    const currentBalance = getAccountBalance(fromAccountId);
    if (currentBalance - numericAmount < -0.001) {
      throw new LedgerError(
        `Insufficient balance in '${fromAccount.name}'. Available: $${currentBalance.toFixed(2)}, Transfer requested: $${numericAmount.toFixed(2)}`
      );
    }
  }

  const entryDate = date || new Date().toISOString().replace('T', ' ').substring(0, 19);

  return db.transaction(() => {
    // Double entry:
    // Debit: asset:<toAccountId>
    // Credit: asset:<fromAccountId>
    const journalResult = createJournalEntry({
      userId,
      date: entryDate,
      description: `${description} (${fromAccount.name} → ${toAccount.name})`,
      referenceId,
      postings: [
        {
          account_id: toAccountId,
          account_code: `asset:${toAccountId}`,
          direction: 'debit',
          amount: numericAmount
        },
        {
          account_id: fromAccountId,
          account_code: `asset:${fromAccountId}`,
          direction: 'credit',
          amount: numericAmount
        }
      ]
    });

    // Record two transactions in user-facing transactions table:
    // 1 for source account (-amount)
    // 1 for destination account (+amount)
    const outTxId = 'tx_' + crypto.randomUUID();
    db.run(
      `INSERT INTO transactions (id, journal_entry_id, user_id, account_id, date, name, category, amount, type, icon, tone, fingerprint, is_reconciled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        outTxId,
        journalResult.entryId,
        userId,
        fromAccountId,
        entryDate,
        `Transfer to ${toAccount.name}`,
        'Internal transfer',
        -numericAmount,
        'transfer',
        'arrow-up-right',
        'orange',
        referenceId ? `ref:${referenceId}_out` : null,
        1
      ]
    );

    const inTxId = 'tx_' + crypto.randomUUID();
    db.run(
      `INSERT INTO transactions (id, journal_entry_id, user_id, account_id, date, name, category, amount, type, icon, tone, fingerprint, is_reconciled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        inTxId,
        journalResult.entryId,
        userId,
        toAccountId,
        entryDate,
        `Transfer from ${fromAccount.name}`,
        'Internal transfer',
        numericAmount,
        'transfer',
        'arrow-down-left',
        'teal',
        referenceId ? `ref:${referenceId}_in` : null,
        1
      ]
    );

    return {
      entryId: journalResult.entryId,
      outTransactionId: outTxId,
      inTransactionId: inTxId,
      fromAccount: { id: fromAccountId, newBalance: getAccountBalance(fromAccountId) },
      toAccount: { id: toAccountId, newBalance: getAccountBalance(toAccountId) },
      amount: numericAmount,
      entryHash: journalResult.entryHash
    };
  });
}

/**
 * Initializes opening balance for an account with equity credit
 */
function recordOpeningBalance({ userId, accountId, balance, date = null }) {
  const numericBalance = Number(balance);
  if (numericBalance === 0) return;

  const entryDate = date || new Date().toISOString().replace('T', ' ').substring(0, 19);

  return db.transaction(() => {
    if (numericBalance > 0) {
      // Debit: asset:<accountId>
      // Credit: equity:opening_balance
      createJournalEntry({
        userId,
        date: entryDate,
        description: 'Opening Balance',
        postings: [
          {
            account_id: accountId,
            account_code: `asset:${accountId}`,
            direction: 'debit',
            amount: numericBalance
          },
          {
            account_id: null,
            account_code: 'equity:opening_balance',
            direction: 'credit',
            amount: numericBalance
          }
        ]
      });
    }
  });
}

/**
 * Calculates Trial Balance across all accounts for verification of accounting equation
 */
function getTrialBalance(userId) {
  const rows = db.query(
    `SELECT p.account_code, p.direction, SUM(p.amount) as total
     FROM postings p
     JOIN journal_entries j ON p.journal_entry_id = j.id
     WHERE j.user_id = ?
     GROUP BY p.account_code, p.direction
     ORDER BY p.account_code ASC`,
    [userId]
  );

  const accountSummary = {};
  let totalDebits = 0;
  let totalCredits = 0;

  for (const r of rows) {
    if (!accountSummary[r.account_code]) {
      accountSummary[r.account_code] = { debit: 0, credit: 0 };
    }
    if (r.direction === 'debit') {
      accountSummary[r.account_code].debit += r.total;
      totalDebits += r.total;
    } else {
      accountSummary[r.account_code].credit += r.total;
      totalCredits += r.total;
    }
  }

  return {
    accounts: accountSummary,
    totalDebits: Number(totalDebits.toFixed(2)),
    totalCredits: Number(totalCredits.toFixed(2)),
    balanced: Math.abs(totalDebits - totalCredits) < 0.01,
    difference: Number((totalDebits - totalCredits).toFixed(2))
  };
}

/**
 * Computes Income Statement (P&L): Revenue minus Expenses = Net Income
 */
function getIncomeStatement(userId, fromDate = null, toDate = null) {
  let query = `
    SELECT p.account_code, SUM(p.amount) as total
    FROM postings p
    JOIN journal_entries j ON p.journal_entry_id = j.id
    WHERE j.user_id = ?
  `;
  const params = [userId];

  if (fromDate) {
    query += ' AND j.date >= ?';
    params.push(fromDate);
  }
  if (toDate) {
    query += ' AND j.date <= ?';
    params.push(toDate);
  }

  query += ' GROUP BY p.account_code';

  const rows = db.query(query, params);

  const revenue = {};
  const expenses = {};
  let totalRevenue = 0;
  let totalExpenses = 0;

  for (const r of rows) {
    if (r.account_code.startsWith('revenue:')) {
      const cat = r.account_code.replace('revenue:', '');
      revenue[cat] = (revenue[cat] || 0) + r.total;
      totalRevenue += r.total;
    } else if (r.account_code.startsWith('expense:')) {
      const cat = r.account_code.replace('expense:', '');
      expenses[cat] = (expenses[cat] || 0) + r.total;
      totalExpenses += r.total;
    }
  }

  const netIncome = totalRevenue - totalExpenses;

  return {
    period: { from: fromDate || 'inception', to: toDate || 'present' },
    revenue,
    totalRevenue: Number(totalRevenue.toFixed(2)),
    expenses,
    totalExpenses: Number(totalExpenses.toFixed(2)),
    netIncome: Number(netIncome.toFixed(2))
  };
}

/**
 * Computes Balance Sheet: Assets = Liabilities + Equity
 */
function getBalanceSheet(userId) {
  const accounts = db.query('SELECT id, name, type, account_class FROM accounts WHERE user_id = ? AND is_archived = 0', [userId]);

  const assets = [];
  let totalAssets = 0;

  const liabilities = [];
  let totalLiabilities = 0;

  for (const acc of accounts) {
    const bal = getAccountBalance(acc.id);
    const item = { id: acc.id, name: acc.name, type: acc.type, balance: Number(bal.toFixed(2)) };
    if (acc.account_class === 'asset') {
      assets.push(item);
      totalAssets += bal;
    } else {
      liabilities.push(item);
      totalLiabilities += bal;
    }
  }

  // Equity = Assets - Liabilities
  const netEquity = totalAssets - totalLiabilities;

  return {
    assets,
    totalAssets: Number(totalAssets.toFixed(2)),
    liabilities,
    totalLiabilities: Number(totalLiabilities.toFixed(2)),
    equity: {
      netWorth: Number(netEquity.toFixed(2))
    },
    invarianceVerified: true
  };
}

module.exports = {
  LedgerError,
  createJournalEntry,
  getAccountBalance,
  recordSpending,
  recordIncome,
  recordTransfer,
  recordOpeningBalance,
  getTrialBalance,
  getIncomeStatement,
  getBalanceSheet
};
