// ============================================================================
// Cryptographic Audit Chain & Tamper Detection Tests
// ============================================================================
const assert = require('assert');
const db = require('../server/db');
const { recordIncome, recordSpending } = require('../server/ledger/ledger-core');
const { verifyAuditChain } = require('../server/ledger/audit-chain');

console.log('🧪 Running tests/audit-chain.test.js...');

const testUser = 'usr_audit_test_' + Date.now();
db.run(
  `INSERT INTO users (id, name, email, password_hash, currency)
   VALUES (?, 'Audit User', ?, 'pw', 'USD')`,
  [testUser, `${testUser}@lumen.test`]
);

const testAcc = 'acc_audit_' + Date.now();
db.run(
  `INSERT INTO accounts (id, user_id, name, type, account_class, currency)
   VALUES (?, ?, 'Audit Checking', 'checking', 'asset', 'USD')`,
  [testAcc, testUser]
);

// Post 3 valid journal entries
recordIncome({ userId: testUser, accountId: testAcc, amount: 5000, category: 'Income', payee: 'Client Pay' });
recordSpending({ userId: testUser, accountId: testAcc, amount: 150, category: 'Food & drink', payee: 'Dinner' });
recordSpending({ userId: testUser, accountId: testAcc, amount: 80, category: 'Transport', payee: 'Train' });

// 1. Verify valid ledger chain
let audit = verifyAuditChain(testUser);
assert.strictEqual(audit.valid, true);
assert.strictEqual(audit.entriesVerified, 3);
assert.strictEqual(audit.tamperDetected, false);
console.log('  ✓ Valid ledger verified successfully with 3 cryptographic blocks');

// 2. Simulate malicious tamper: hacker alters amount of entry #2 in database
const entry2 = db.get('SELECT id FROM journal_entries WHERE user_id = ? AND sequence_num = 2', [testUser]);
assert.ok(entry2);

// Corrupt posting amount directly in the postings table
db.run(
  'UPDATE postings SET amount = 9999.99 WHERE journal_entry_id = ? AND direction = ?',
  [entry2.id, 'debit']
);

// 3. Verify audit chain detects tamper
audit = verifyAuditChain(testUser);
assert.strictEqual(audit.valid, false);
assert.strictEqual(audit.tamperDetected, true);
assert.strictEqual(audit.brokenAtSequence, 2);
console.log(`  ✓ Tamper successfully detected at sequence #${audit.brokenAtSequence}: ${audit.reason}`);

console.log('🎉 tests/audit-chain.test.js PASSED!\n');
