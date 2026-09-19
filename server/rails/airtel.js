// ============================================================================
// Airtel Money API Payment Rail Connector
// Implements Airtel Money USSD Push (Collections), Callbacks, and Payouts
// Multi-country support: Kenya (KES), Uganda (UGX), Rwanda (RWF), Zambia (ZMW)
// Settles directly into the double-entry accounting ledger
// ============================================================================
const crypto = require('crypto');
const db = require('../db');
const { recordIncome, recordSpending, getAccountBalance } = require('../ledger/ledger-core');

// Standard reference exchange rates to USD
const AIRTEL_RATES = {
  KES: 1 / 130.0,
  UGX: 1 / 3700.0,
  RWF: 1 / 1300.0,
  ZMW: 1 / 26.0
};

function ensureAirtelAccount(userId, currency = 'KES') {
  const curr = currency.toUpperCase();
  let account = db.get(
    "SELECT id, name, currency FROM accounts WHERE user_id = ? AND (name LIKE '%Airtel%' OR id LIKE 'acc_airtel_%')",
    [userId]
  );

  if (!account) {
    const accountId = 'acc_airtel_' + crypto.randomBytes(4).toString('hex');
    db.run(
      `INSERT INTO accounts (id, user_id, name, type, account_class, currency, institution, initial_balance)
       VALUES (?, ?, 'Airtel Money Wallet', 'cash', 'asset', ?, 'Airtel Africa', 0)`,
      [accountId, userId, curr]
    );
    account = { id: accountId, name: 'Airtel Money Wallet', currency: curr };
  }

  return account;
}

/**
 * Initiates Airtel Money USSD Push (Collection / Deposit)
 */
function initiateAirtelPush({ userId, phoneNumber, amountLocal, currency = 'KES', description = 'Lumen Wallet Top-up' }) {
  const numericAmount = Math.round(Number(amountLocal));
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('Airtel amount must be a positive number');
  }

  const curr = currency.toUpperCase();
  const rate = AIRTEL_RATES[curr] || (1 / 130.0);

  let cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  if (cleanPhone.length < 9) {
    throw new Error('Invalid mobile number format for Airtel Money');
  }

  const airtelAccount = ensureAirtelAccount(userId, curr);
  const reference = 'AM_TX_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const railTxId = 'rail_' + crypto.randomUUID();
  const usdAmount = Number((numericAmount * rate).toFixed(2));

  db.run(
    `INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json)
     VALUES (?, ?, 'airtel', 'inflow', 'pending', ?, ?, ?, ?, ?)`,
    [
      railTxId,
      userId,
      numericAmount,
      curr,
      reference,
      cleanPhone,
      JSON.stringify({
        description,
        accountId: airtelAccount.id,
        convertedUsd: usdAmount
      })
    ]
  );

  return {
    success: true,
    reference,
    railTxId,
    phoneNumber: cleanPhone,
    amountLocal: numericAmount,
    currency: curr,
    convertedUsd: usdAmount,
    status: 'pending',
    message: `Airtel Money USSD collection prompt sent to ${cleanPhone} (${curr} ${numericAmount.toLocaleString()}). Confirm PIN on phone.`
  };
}

/**
 * Handles Airtel Callback Webhook
 */
function handleAirtelCallback(payload) {
  const reference = payload?.transaction?.id || payload?.reference || payload?.ref;
  if (!reference) {
    throw new Error('Invalid Airtel callback payload: missing transaction reference');
  }

  const statusStr = (payload?.transaction?.status || payload?.status || '').toUpperCase();
  const isSuccess = statusStr === 'SUCCESS' || statusStr === 'TS' || payload?.code === '200';

  const railTx = db.get(
    "SELECT * FROM payment_rails_transactions WHERE reference = ? AND rail = 'airtel'",
    [reference]
  );

  if (!railTx) {
    throw new Error(`No pending Airtel transaction found for reference: ${reference}`);
  }

  if (railTx.status === 'completed') {
    return { success: true, message: 'Transaction already completed and reconciled' };
  }

  let metadata = {};
  try { metadata = JSON.parse(railTx.metadata_json); } catch (e) {}

  if (isSuccess) {
    const rate = AIRTEL_RATES[railTx.currency] || (1 / 130.0);
    const usdAmount = Number((railTx.amount * rate).toFixed(2));
    const airtelAccount = ensureAirtelAccount(railTx.user_id, railTx.currency);

    const ledgerResult = recordIncome({
      userId: railTx.user_id,
      accountId: airtelAccount.id,
      amount: usdAmount,
      category: 'Airtel Money Deposit',
      payee: `Airtel Money Inward (${reference})`,
      referenceId: reference,
      icon: 'smartphone',
      tone: 'teal'
    });

    db.run(
      `UPDATE payment_rails_transactions
       SET status = 'completed', journal_entry_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [ledgerResult.journalEntryId, railTx.id]
    );

    return {
      success: true,
      status: 'completed',
      reference,
      amountLocal: railTx.amount,
      currency: railTx.currency,
      creditedUsd: usdAmount,
      message: `Airtel Money payment ${reference} successfully settled.`
    };
  } else {
    db.run(
      `UPDATE payment_rails_transactions
       SET status = 'failed', metadata_json = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [JSON.stringify({ ...metadata, callbackPayload: payload }), railTx.id]
    );

    return { success: false, status: 'failed', reference };
  }
}

/**
 * Sends Airtel Money Payout (Withdrawal / Disbursement)
 */
function sendAirtelPayout({ userId, recipientPhone, amountLocal, currency = 'KES', description = 'Lumen Airtel Payout' }) {
  const numericAmount = Math.round(Number(amountLocal));
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('Airtel payout amount must be positive');
  }

  const curr = currency.toUpperCase();
  const rate = AIRTEL_RATES[curr] || (1 / 130.0);
  const usdAmount = Number((numericAmount * rate).toFixed(2));

  let cleanPhone = recipientPhone.replace(/[^0-9]/g, '');
  const airtelAccount = ensureAirtelAccount(userId, curr);

  const currentBalance = getAccountBalance(airtelAccount.id);
  if (currentBalance < usdAmount) {
    throw new Error(`Insufficient funds in Airtel Wallet. Available: $${currentBalance.toFixed(2)}, Requested: ${curr} ${numericAmount} ($${usdAmount})`);
  }

  const reference = 'AM_OUT_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const railTxId = 'rail_' + crypto.randomUUID();

  const ledgerResult = recordSpending({
    userId,
    accountId: airtelAccount.id,
    amount: usdAmount,
    category: 'Airtel Money Payout',
    payee: `Airtel Payout to ${cleanPhone}`,
    referenceId: reference,
    icon: 'arrow-up-right',
    tone: 'orange'
  });

  db.run(
    `INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json, journal_entry_id)
     VALUES (?, ?, 'airtel', 'outflow', 'completed', ?, ?, ?, ?, ?, ?)`,
    [
      railTxId,
      userId,
      numericAmount,
      curr,
      reference,
      cleanPhone,
      JSON.stringify({ description, convertedUsd: usdAmount }),
      ledgerResult.journalEntryId
    ]
  );

  return {
    success: true,
    status: 'completed',
    reference,
    recipientPhone: cleanPhone,
    amountLocal: numericAmount,
    currency: curr,
    debitedUsd: usdAmount,
    newBalanceUsd: getAccountBalance(airtelAccount.id),
    message: `${curr} ${numericAmount.toLocaleString()} disbursed to ${cleanPhone} via Airtel Money.`
  };
}

module.exports = {
  AIRTEL_RATES,
  ensureAirtelAccount,
  initiateAirtelPush,
  handleAirtelCallback,
  sendAirtelPayout
};
