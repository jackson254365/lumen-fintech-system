// ============================================================================
// Statement Deduplication Engine
// Prevents duplicate transactions across overlapping bank statements
// ============================================================================
const crypto = require('crypto');
const db = require('../db');

/**
 * Computes deterministic SHA-256 fingerprint for a transaction
 */
function computeFingerprint(accountId, date, description, amount, referenceId = '') {
  const normDate = (date || '').substring(0, 10);
  const normDesc = (description || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normAmount = Number(amount).toFixed(2);
  const normRef = (referenceId || '').trim();

  // If a bank reference/transaction ID exists, use it in combination with account
  const rawKey = normRef
    ? `${accountId}:${normRef}`
    : `${accountId}:${normDate}:${normDesc}:${normAmount}`;

  return crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/**
 * Filters a list of parsed transactions into new vs. duplicate
 */
function deduplicateTransactions(userId, accountId, parsedTransactions) {
  // Fetch existing fingerprints for this user & account
  const existingRows = db.query(
    'SELECT fingerprint FROM transactions WHERE user_id = ? AND account_id = ? AND fingerprint IS NOT NULL',
    [userId, accountId]
  );
  const existingSet = new Set(existingRows.map(r => r.fingerprint));

  const unique = [];
  const duplicates = [];

  for (const item of parsedTransactions) {
    const fp = computeFingerprint(accountId, item.date, item.description, item.amount, item.referenceId);
    if (existingSet.has(fp)) {
      duplicates.push({ ...item, fingerprint: fp, reason: 'Already exists in database' });
    } else {
      // Also check if we have duplicate rows within the same batch upload
      existingSet.add(fp);
      unique.push({ ...item, fingerprint: fp });
    }
  }

  return {
    totalParsed: parsedTransactions.length,
    newCount: unique.length,
    duplicateCount: duplicates.length,
    newTransactions: unique,
    duplicateTransactions: duplicates
  };
}

module.exports = {
  computeFingerprint,
  deduplicateTransactions
};
