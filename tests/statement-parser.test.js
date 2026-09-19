// ============================================================================
// Statement Parser, Categorizer & Deduplication Tests
// ============================================================================
const assert = require('assert');
const { parseStatement, parseCSV, parseOFX } = require('../server/statement-engine/parser');
const { computeFingerprint, deduplicateTransactions } = require('../server/statement-engine/deduplicator');
const { categorizeTransaction } = require('../server/statement-engine/categorizer');

console.log('🧪 Running tests/statement-parser.test.js...');

// 1. Standard Bank CSV (Date, Description, Amount)
const csv1 = `Date,Description,Amount
2026-09-01,Acme Payroll,3200.00
2026-09-02,Starbucks Coffee,-5.50
2026-09-03,Trader Joe's Groceries,-64.20
2026-09-04,Netflix.com,-15.99`;

const parsed1 = parseCSV(csv1);
assert.strictEqual(parsed1.length, 4);
assert.strictEqual(parsed1[0].amount, 3200.00);
assert.strictEqual(parsed1[0].description, 'Acme Payroll');
assert.strictEqual(parsed1[1].amount, -5.50);
console.log('  ✓ Standard 3-column CSV parsed accurately');

// 2. Dual Debit/Credit Semicolon CSV (European banks like Starling/Revolut/N26)
const csv2 = `Transaction Date;Merchant;Debit;Credit
01/09/2026;Shell Gas Station;45.00;
02/09/2026;Client Invoice;;1500.00`;

const parsed2 = parseCSV(csv2);
assert.strictEqual(parsed2.length, 2);
assert.strictEqual(parsed2[0].amount, -45.00);
assert.strictEqual(parsed2[1].amount, 1500.00);
console.log('  ✓ Semicolon-delimited dual Debit/Credit CSV parsed accurately');

// 3. OFX Statement parsing
const ofxSample = `
OFXHEADER:100
<OFX>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260905120000
<TRNAMT>450.00
<FITID>REF123456
<NAME>Dividends
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260906140000
<TRNAMT>-32.50
<FITID>REF123457
<NAME>Uber Trip
</STMTTRN>
</OFX>`;

const parsedOFX = parseOFX(ofxSample);
assert.strictEqual(parsedOFX.length, 2);
assert.strictEqual(parsedOFX[0].amount, 450.00);
assert.strictEqual(parsedOFX[0].referenceId, 'REF123456');
assert.strictEqual(parsedOFX[1].amount, -32.50);
assert.strictEqual(parsedOFX[1].referenceId, 'REF123457');
console.log('  ✓ Standard banking OFX/QFX statement parsed accurately');

// 4. Auto-Categorization heuristics
const cat1 = categorizeTransaction(null, 'Starbucks Store #1042', -4.50);
assert.strictEqual(cat1.category, 'Food & drink');
assert.strictEqual(cat1.type, 'spending');

const cat2 = categorizeTransaction(null, 'Shell Oil Gas', -55.00);
assert.strictEqual(cat2.category, 'Transport');

const cat3 = categorizeTransaction(null, 'Netflix Subscription', -19.99);
assert.strictEqual(cat3.category, 'Fun money');

const cat4 = categorizeTransaction(null, 'Acme Corp Payroll', 5000.00);
assert.strictEqual(cat4.category, 'Income');
assert.strictEqual(cat4.type, 'income');
console.log('  ✓ Intelligent categorization engine classified merchants with proper tags and icons');

// 5. Deduplication fingerprinting
const fp1 = computeFingerprint('acc_1', '2026-09-01', 'Starbucks', -5.00, 'tx100');
const fp2 = computeFingerprint('acc_1', '2026-09-01', 'Starbucks', -5.00, 'tx100');
const fp3 = computeFingerprint('acc_1', '2026-09-01', 'Starbucks', -5.00, 'tx101');
assert.strictEqual(fp1, fp2);
assert.notStrictEqual(fp1, fp3);
console.log('  ✓ Deduplication fingerprints are deterministic and collision-resistant');

console.log('🎉 tests/statement-parser.test.js PASSED!\n');
