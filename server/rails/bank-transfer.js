// ============================================================================
// Bank Wire / ACH / SEPA Payment Rail Connector
// Standard international wire, SEPA, and ACH transfer engine with ledger settlement
// ============================================================================
const crypto = require('crypto');
const db = require('../db');
const { recordIncome, recordSpending, getAccountBalance } = require('../ledger/ledger-core');

function ensureBankWireAccount(userId) {
  let account = db.get(
    "SELECT id, name, currency FROM accounts WHERE user_id = ? AND (name LIKE '%Wire%' OR id LIKE 'acc_wire_%')",
    [userId]
  );

  if (!account) {
    const accountId = 'acc_wire_' + crypto.randomBytes(4).toString('hex');
    db.run(
      `INSERT INTO accounts (id, user_id, name, type, account_class, currency, institution, initial_balance)
       VALUES (?, ?, 'Global Wire Account', 'checking', 'asset', 'USD', 'Lumen Clearing Bank', 0)`,
      [accountId, userId]
    );
    account = { id: accountId, name: 'Global Wire Account', currency: 'USD' };
  }

  return account;
}

/**
 * Initiates an outbound wire transfer (SWIFT, SEPA, ACH, or LOCAL)
 */
function initiateWireTransfer({ userId, iban, bic, recipientName, amountUsd, description = 'Wire Transfer', type = 'SWIFT' }) {
  const numericAmount = Number(amountUsd);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('Wire amount must be a positive number in USD');
  }

  const bankAccount = ensureBankWireAccount(userId);
  const currentBalance = getAccountBalance(bankAccount.id);

  if (currentBalance < numericAmount) {
    throw new Error(`Insufficient funds for wire transfer. Available: $${currentBalance.toFixed(2)}, Requested: $${numericAmount.toFixed(2)}`);
  }

  const wireId = 'WIRE_' + type.toUpperCase() + '_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const railTxId = 'rail_' + crypto.randomUUID();

  // Atomically debit account in ledger
  const ledgerResult = recordSpending({
    userId,
    accountId: bankAccount.id,
    amount: numericAmount,
    category: 'Bank Wire Outward',
    payee: `${type} Wire to ${recipientName} (${iban.substring(0, 8)}...)`,
    referenceId: wireId,
    icon: 'landmark',
    tone: 'orange'
  });

  db.run(
    `INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json, journal_entry_id)
     VALUES (?, ?, 'bank_transfer', 'outflow', 'pending', ?, 'USD', ?, ?, ?, ?)`,
    [
      railTxId,
      userId,
      numericAmount,
      wireId,
      iban,
      JSON.stringify({
        bic: bic || 'LUMXUS33',
        recipientName,
        transferType: type,
        description,
        bankAccountId: bankAccount.id
      }),
      ledgerResult.journalEntryId
    ]
  );

  return {
    success: true,
    wireId,
    railTxId,
    transferType: type,
    recipientName,
    iban,
    amountUsd: numericAmount,
    status: 'pending',
    message: `${type} wire transfer of $${numericAmount.toFixed(2)} to ${recipientName} submitted for clearing.`
  };
}

/**
 * Records an inbound wire transfer (Credit to user's clearing account)
 */
function receiveInboundWire({ userId, senderName, senderIban, amountUsd, reference, description = 'Inbound Wire Transfer' }) {
  const numericAmount = Number(amountUsd);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('Inbound wire amount must be positive');
  }

  const bankAccount = ensureBankWireAccount(userId);
  const wireRef = reference || ('IN_WIRE_' + crypto.randomBytes(4).toString('hex').toUpperCase());
  const railTxId = 'rail_' + crypto.randomUUID();

  const ledgerResult = recordIncome({
    userId,
    accountId: bankAccount.id,
    amount: numericAmount,
    category: 'Bank Wire Inward',
    payee: `Inbound Wire from ${senderName}`,
    referenceId: wireRef,
    icon: 'landmark',
    tone: 'teal'
  });

  db.run(
    `INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json, journal_entry_id)
     VALUES (?, ?, 'bank_transfer', 'inflow', 'completed', ?, 'USD', ?, ?, ?, ?)`,
    [
      railTxId,
      userId,
      numericAmount,
      wireRef,
      senderIban || 'N/A',
      JSON.stringify({ senderName, description, bankAccountId: bankAccount.id }),
      ledgerResult.journalEntryId
    ]
  );

  return {
    success: true,
    status: 'completed',
    reference: wireRef,
    senderName,
    amountUsd: numericAmount,
    newBalanceUsd: getAccountBalance(bankAccount.id),
    message: `Inbound wire of $${numericAmount.toFixed(2)} received from ${senderName} and credited to ledger.`
  };
}

/**
 * Handles clearing bank webhook update (e.g. wire transitions from 'pending' to 'completed' or 'failed')
 */
function handleBankWebhook(payload) {
  const wireId = payload?.wireId || payload?.reference;
  const newStatus = payload?.status?.toLowerCase();

  if (!wireId || !newStatus) {
    throw new Error('Invalid bank webhook payload: wireId and status are required');
  }

  const railTx = db.get(
    "SELECT * FROM payment_rails_transactions WHERE reference = ? AND rail = 'bank_transfer'",
    [wireId]
  );

  if (!railTx) {
    throw new Error(`Wire transaction not found for reference: ${wireId}`);
  }

  let metadata = {};
  try { metadata = JSON.parse(railTx.metadata_json); } catch (e) {}

  if (newStatus === 'completed' || newStatus === 'cleared') {
    db.run(
      "UPDATE payment_rails_transactions SET status = 'completed', updated_at = datetime('now') WHERE id = ?",
      [railTx.id]
    );

    return { success: true, wireId, status: 'completed', message: `Wire ${wireId} marked completed.` };
  } else if (newStatus === 'failed' || newStatus === 'rejected') {
    // If an outbound wire fails, credit back the user's account
    if (railTx.direction === 'outflow' && railTx.status === 'pending') {
      const bankAccount = ensureBankWireAccount(railTx.user_id);
      recordIncome({
        userId: railTx.user_id,
        accountId: bankAccount.id,
        amount: railTx.amount,
        category: 'Wire Reversal',
        payee: `Wire Refund (${wireId})`,
        referenceId: 'REV_' + wireId,
        icon: 'rotate-ccw',
        tone: 'teal'
      });
    }

    db.run(
      "UPDATE payment_rails_transactions SET status = 'failed', metadata_json = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify({ ...metadata, failureReason: payload.reason || 'Rejected by intermediary bank' }), railTx.id]
    );

    return { success: true, wireId, status: 'failed', message: `Wire ${wireId} failed and funds reversed.` };
  }

  return { success: true, wireId, status: railTx.status };
}

function getWireStatus(wireId) {
  const tx = db.get("SELECT * FROM payment_rails_transactions WHERE reference = ? AND rail = 'bank_transfer'", [wireId]);
  if (!tx) return null;

  return {
    wireId: tx.reference,
    direction: tx.direction,
    status: tx.status,
    amountUsd: tx.amount,
    createdAt: tx.created_at,
    updatedAt: tx.updated_at,
    metadata: tx.metadata_json ? JSON.parse(tx.metadata_json) : {}
  };
}

module.exports = {
  ensureBankWireAccount,
  initiateWireTransfer,
  receiveInboundWire,
  handleBankWebhook,
  getWireStatus
};
