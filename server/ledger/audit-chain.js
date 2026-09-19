// ============================================================================
// Cryptographic SHA-256 Audit Trail
// Implements tamper-evident hash chaining across all journal entries
// ============================================================================
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

/**
 * Computes canonical SHA-256 hash of a journal entry and its postings
 */
function computeEntryHash(prevHash, sequenceNum, entryId, date, description, postings) {
  // Sort postings deterministically by account_code and direction to ensure stable serialization
  const normalizedPostings = [...postings].sort((a, b) => {
    if (a.account_code < b.account_code) return -1;
    if (a.account_code > b.account_code) return 1;
    return a.direction.localeCompare(b.direction);
  }).map(p => ({
    code: p.account_code,
    dir: p.direction,
    amt: Number(p.amount).toFixed(2)
  }));

  const payload = JSON.stringify({
    prev: prevHash,
    seq: sequenceNum,
    id: entryId,
    dt: date,
    desc: description,
    post: normalizedPostings
  });

  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Gets the latest entry hash for a user, or returns genesis hash if first entry
 */
function getLatestTip(userId) {
  const latest = db.get(
    'SELECT entry_hash, sequence_num FROM journal_entries WHERE user_id = ? ORDER BY sequence_num DESC LIMIT 1',
    [userId]
  );

  if (!latest) {
    return {
      hash: config.HASH_GENESIS,
      sequence: 0
    };
  }

  return {
    hash: latest.entry_hash,
    sequence: latest.sequence_num
  };
}

/**
 * Verifies the integrity of the entire cryptographic ledger chain for a given user.
 * Recalculates every SHA-256 hash in sequence from genesis to tip.
 */
function verifyAuditChain(userId) {
  const entries = db.query(
    'SELECT id, sequence_num, date, description, prev_hash, entry_hash FROM journal_entries WHERE user_id = ? ORDER BY sequence_num ASC',
    [userId]
  );

  if (entries.length === 0) {
    return {
      valid: true,
      entriesVerified: 0,
      tipHash: config.HASH_GENESIS,
      tamperDetected: false,
      message: 'Ledger is empty. Cryptographic genesis state intact.'
    };
  }

  let expectedPrevHash = config.HASH_GENESIS;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedSeq = i + 1;

    if (entry.sequence_num !== expectedSeq) {
      return {
        valid: false,
        entriesVerified: i,
        tamperDetected: true,
        brokenAtSequence: entry.sequence_num,
        brokenEntryId: entry.id,
        reason: `Sequence gap detected: expected ${expectedSeq}, found ${entry.sequence_num}`
      };
    }

    if (entry.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        entriesVerified: i,
        tamperDetected: true,
        brokenAtSequence: entry.sequence_num,
        brokenEntryId: entry.id,
        reason: `Previous hash pointer mismatch at entry ${entry.id}`
      };
    }

    // Retrieve all postings for this entry
    const postings = db.query(
      'SELECT account_code, direction, amount FROM postings WHERE journal_entry_id = ?',
      [entry.id]
    );

    const recomputedHash = computeEntryHash(
      entry.prev_hash,
      entry.sequence_num,
      entry.id,
      entry.date,
      entry.description,
      postings
    );

    if (recomputedHash !== entry.entry_hash) {
      return {
        valid: false,
        entriesVerified: i,
        tamperDetected: true,
        brokenAtSequence: entry.sequence_num,
        brokenEntryId: entry.id,
        expectedHash: recomputedHash,
        actualHash: entry.entry_hash,
        reason: `Cryptographic SHA-256 signature mismatch: entry was altered or postings modified`
      };
    }

    expectedPrevHash = entry.entry_hash;
  }

  return {
    valid: true,
    entriesVerified: entries.length,
    tipHash: expectedPrevHash,
    tamperDetected: false,
    message: `All ${entries.length} cryptographic blocks mathematically verified. Zero tampering detected.`
  };
}

module.exports = {
  computeEntryHash,
  getLatestTip,
  verifyAuditChain
};
