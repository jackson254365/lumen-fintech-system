// ============================================================================
// Standard Chart of Accounts & Normal Balance Definitions
// ============================================================================

const ACCOUNT_TYPES = {
  ASSET: 'asset',
  LIABILITY: 'liability',
  EQUITY: 'equity',
  REVENUE: 'revenue',
  EXPENSE: 'expense'
};

const NORMAL_BALANCES = {
  [ACCOUNT_TYPES.ASSET]: 'debit',
  [ACCOUNT_TYPES.LIABILITY]: 'credit',
  [ACCOUNT_TYPES.EQUITY]: 'credit',
  [ACCOUNT_TYPES.REVENUE]: 'credit',
  [ACCOUNT_TYPES.EXPENSE]: 'debit'
};

/**
 * Parses an account code into type and identifier
 * e.g. "asset:everyday" -> { type: 'asset', identifier: 'everyday' }
 *      "expense:Food & drink" -> { type: 'expense', identifier: 'Food & drink' }
 */
function parseAccountCode(code) {
  const parts = code.split(':');
  if (parts.length < 2) {
    throw new Error(`Invalid account code format: ${code}`);
  }
  const type = parts[0].toLowerCase();
  const identifier = parts.slice(1).join(':');
  return { type, identifier };
}

/**
 * Calculates balance change based on direction (debit/credit) and normal balance rule
 */
function calculateBalanceDelta(accountType, direction, amount) {
  const normal = NORMAL_BALANCES[accountType];
  if (!normal) {
    throw new Error(`Unknown account type: ${accountType}`);
  }
  // Normal balance increases when matching direction, decreases when opposite
  if (direction === normal) {
    return amount;
  } else {
    return -amount;
  }
}

module.exports = {
  ACCOUNT_TYPES,
  NORMAL_BALANCES,
  parseAccountCode,
  calculateBalanceDelta
};
