// ============================================================================
// Double-Entry Ledger Core Tests
// ============================================================================
const assert = require('assert');
const db = require('../server/db');
const {
  createJournalEntry,
  getAccountBalance,
  recordSpending,
  recordIncome,
  recordTransfer,
  getTrialBalance,
  getBalanceSheet,
  LedgerError
} = require('../server/ledger/ledger-core');
const { verifyAuditChain } = require('../server/ledger/audit-chain');

console.log('🧪 Running tests/ledger.test.js...');

const testUser = 'usr_test_ledger_' + Date.now();
db.run(
  `INSERT INTO users (id, name, email, password_hash, currency)
   VALUES (?, 'Test User', ?, 'pw', 'USD')`,
  [testUser, `${testUser}@lumen.test`]
);

const acc1 = 'acc_test_checking_' + Date.now();
const acc2 = 'acc_test_savings_' + Date.now();

db.run(
  `INSERT INTO accounts (id, user_id, name, type, account_class, currency, initial_balance)
   VALUES (?, ?, 'Checking Test', 'checking', 'asset', 'USD', 1000.00)`,
  [acc1, testUser]
);

db.run(
  `INSERT INTO accounts (id, user_id, name, type, account_class, currency, initial_balance)
   VALUES (?, ?, 'Savings Test', 'savings', 'asset', 'USD', 500.00)`,
  [acc2, testUser]
);

// 1. Unbalanced entries should fail
assert.throws(() => {
  createJournalEntry({
    userId: testUser,
    date: '2026-09-08 10:00:00',
    description: 'Unbalanced entry',
    postings: [
      { account_code: 'asset:' + acc1, direction: 'debit', amount: 100 },
      { account_code: 'expense:Food', direction: 'credit', amount: 50 } // $50 mismatch!
    ]
  });
}, /Unbalanced journal entry/);
console.log('  ✓ Correctly rejected unbalanced journal entry');

// 2. Initial balance deposits
recordIncome({
  userId: testUser,
  accountId: acc1,
  amount: 1000.00,
  category: 'Income',
  payee: 'Initial Deposit'
});
assert.strictEqual(getAccountBalance(acc1), 1000.00);
console.log('  ✓ Income recorded and balance accurately updated');

// 3. Spending deduction
recordSpending({
  userId: testUser,
  accountId: acc1,
  amount: 250.00,
  category: 'Food & drink',
  payee: 'Grocery Store'
});
assert.strictEqual(getAccountBalance(acc1), 750.00);
console.log('  ✓ Spending deducted and balance accurately updated');

// 4. Overdraft protection: Spending more than available should throw
assert.throws(() => {
  recordSpending({
    userId: testUser,
    accountId: acc1,
    amount: 10000.00,
    category: 'Home',
    payee: 'Luxury Item'
  });
}, /Insufficient funds/);
console.log('  ✓ Overdraft protection enforced');

// 5. Transfer between accounts
recordTransfer({
  userId: testUser,
  fromAccountId: acc1,
  toAccountId: acc2,
  amount: 200.00,
  description: 'Move to savings'
});
assert.strictEqual(getAccountBalance(acc1), 550.00);
assert.strictEqual(getAccountBalance(acc2), 200.00);
console.log('  ✓ Inter-account transfer balanced and executed');

// 6. Trial balance must balance exactly
const trial = getTrialBalance(testUser);
assert.strictEqual(trial.balanced, true);
assert.strictEqual(trial.totalDebits, trial.totalCredits);
console.log(`  ✓ Trial Balance verified: $${trial.totalDebits} Debits === $${trial.totalCredits} Credits`);

// 7. Cryptographic audit chain must verify
const audit = verifyAuditChain(testUser);
assert.strictEqual(audit.valid, true);
assert.strictEqual(audit.tamperDetected, false);
console.log(`  ✓ Cryptographic hash chain verified (${audit.entriesVerified} entries)`);

console.log('🎉 tests/ledger.test.js PASSED!\n');
