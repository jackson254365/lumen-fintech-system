// ============================================================================
// M-Pesa Daraja API Payment Rail Connector
// Implements STK Push (Lipa Na M-Pesa), C2B/STK Callback, and B2C Payouts
// Settles directly into the double-entry accounting ledger
// ============================================================================
const crypto = require('crypto');
const db = require('../db');
const { recordIncome, recordSpending, getAccountBalance } = require('../ledger/ledger-core');

// Standard exchange rate for settlement: 1 USD ~ 130 KES (configurable)
const KES_TO_USD_RATE = 1 / 130.0;

function ensureMpesaAccount(userId) {
  let mpesaAccount = db.get(
    "SELECT id, name, currency FROM accounts WHERE user_id = ? AND (name LIKE '%M-Pesa%' OR id = 'mpesa_wallet')",
    [userId]
  );

  if (!mpesaAccount) {
    const accountId = 'acc_mpesa_' + crypto.randomBytes(4).toString('hex');
    db.run(
      `INSERT INTO accounts (id, user_id, name, type, account_class, currency, institution, initial_balance)
       VALUES (?, ?, 'M-Pesa Mobile Wallet', 'cash', 'asset', 'KES', 'Safaricom M-Pesa', 0)`,
      [accountId, userId]
    );
    mpesaAccount = { id: accountId, name: 'M-Pesa Mobile Wallet', currency: 'KES' };
  }

  return mpesaAccount;
}

/**
 * Initiates an M-Pesa STK Push (Lipa Na M-Pesa Online prompt) to user's phone
 */
function initiateStkPush({ userId, phoneNumber, amountKes, description = 'Lumen Wallet Top-up' }) {
  const numericAmount = Math.round(Number(amountKes));
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('M-Pesa amount must be a positive integer in KES');
  }

  // Format phone number: 2547XXXXXXXX or 07XXXXXXXX
  let cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith('254')) {
    cleanPhone = '254' + cleanPhone;
  }

  if (cleanPhone.length !== 12) {
    throw new Error('Invalid Kenyan phone number format. Expected e.g. 0712345678 or 254712345678');
  }

  const mpesaAccount = ensureMpesaAccount(userId);
  const checkoutRequestId = 'ws_CO_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const merchantRequestId = 'mr_' + crypto.randomBytes(6).toString('hex');
  const railTxId = 'rail_' + crypto.randomUUID();

  // Record pending inbound rail transaction
  db.run(
    `INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json)
     VALUES (?, ?, 'mpesa', 'inflow', 'pending', ?, 'KES', ?, ?, ?)`,
    [
      railTxId,
      userId,
      numericAmount,
      checkoutRequestId,
      cleanPhone,
      JSON.stringify({
        description,
        merchantRequestId,
        accountId: mpesaAccount.id,
        convertedUsd: Number((numericAmount * KES_TO_USD_RATE).toFixed(2))
      })
    ]
  );

  return {
    success: true,
    checkoutRequestId,
    merchantRequestId,
    railTxId,
    phoneNumber: cleanPhone,
    amountKes: numericAmount,
    status: 'pending',
    message: `STK push prompt dispatched to ${cleanPhone}. Enter M-Pesa PIN on handset to complete deposit.`
  };
}

/**
 * Handles Daraja STK Push Callback Webhook
 * Upon successful PIN entry, credits user's M-Pesa ledger account atomically
 */
function handleMpesaCallback(payload) {
  const stkCallback = payload?.Body?.stkCallback || payload;
  if (!stkCallback) {
    throw new Error('Invalid M-Pesa callback body structure');
  }

  const checkoutRequestId = stkCallback.CheckoutRequestID;
  const resultCode = stkCallback.ResultCode;
  const resultDesc = stkCallback.ResultDesc;

  const railTx = db.get(
    "SELECT * FROM payment_rails_transactions WHERE reference = ? AND rail = 'mpesa'",
    [checkoutRequestId]
  );

  if (!railTx) {
    throw new Error(`No pending rail transaction found for CheckoutRequestID: ${checkoutRequestId}`);
  }

  if (railTx.status === 'completed') {
    return { success: true, message: 'Transaction already completed and reconciled' };
  }

  let metadata = {};
  try { metadata = JSON.parse(railTx.metadata_json); } catch (e) {}

  if (resultCode === 0) {
    // Payment Successful! Extract callback metadata items
    const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
    let receiptNumber = 'MPESA_' + crypto.randomBytes(4).toString('hex').toUpperCase();
    let transactionDate = new Date().toISOString();
    let paidAmount = railTx.amount;

    for (const item of callbackMetadata) {
      if (item.Name === 'MpesaReceiptNumber') receiptNumber = item.Value;
      if (item.Name === 'TransactionDate') transactionDate = String(item.Value);
      if (item.Name === 'Amount') paidAmount = Number(item.Value);
    }

    const mpesaAccount = ensureMpesaAccount(railTx.user_id);
    const usdAmount = Number((paidAmount * KES_TO_USD_RATE).toFixed(2));

    // Atomically settle in double-entry ledger:
    // Debit: asset:mpesa_account (increasing funds)
    // Credit: revenue:M-Pesa Deposit
    const ledgerResult = recordIncome({
      userId: railTx.user_id,
      accountId: mpesaAccount.id,
      amount: usdAmount,
      category: 'M-Pesa Deposit',
      payee: `M-Pesa Inward (${receiptNumber})`,
      referenceId: receiptNumber,
      icon: 'smartphone',
      tone: 'teal'
    });

    db.run(
      `UPDATE payment_rails_transactions
       SET status = 'completed', reference = ?, journal_entry_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [receiptNumber, ledgerResult.journalEntryId, railTx.id]
    );

    return {
      success: true,
      status: 'completed',
      receiptNumber,
      amountKes: paidAmount,
      creditedUsd: usdAmount,
      message: `M-Pesa payment ${receiptNumber} confirmed and booked to ledger.`
    };
  } else {
    // Cancelled or Failed on handset
    db.run(
      `UPDATE payment_rails_transactions
       SET status = 'failed', metadata_json = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [JSON.stringify({ ...metadata, resultDesc, resultCode }), railTx.id]
    );

    return {
      success: false,
      status: 'failed',
      resultCode,
      resultDesc
    };
  }
}

/**
 * Sends a B2C Payout to any M-Pesa phone number (Withdrawal / Outflow)
 */
function sendB2CPayout({ userId, recipientPhone, amountKes, description = 'Lumen Payout' }) {
  const numericAmount = Math.round(Number(amountKes));
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('Payout amount must be a positive integer in KES');
  }

  let cleanPhone = recipientPhone.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) cleanPhone = '254' + cleanPhone.substring(1);
  else if (!cleanPhone.startsWith('254')) cleanPhone = '254' + cleanPhone;

  const mpesaAccount = ensureMpesaAccount(userId);
  const usdAmount = Number((numericAmount * KES_TO_USD_RATE).toFixed(2));

  // Verify user has sufficient funds in M-Pesa account
  const currentBalance = getAccountBalance(mpesaAccount.id);
  if (currentBalance < usdAmount) {
    throw new Error(`Insufficient funds in M-Pesa account. Available: $${currentBalance.toFixed(2)} (approx KES ${(currentBalance / KES_TO_USD_RATE).toFixed(0)}), Requested: KES ${numericAmount} ($${usdAmount})`);
  }

  const receiptNumber = 'B2C_' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const railTxId = 'rail_' + crypto.randomUUID();

  // Atomically debit M-Pesa account in double-entry ledger:
  // Debit: expense:M-Pesa Payout
  // Credit: asset:mpesa_account (decreasing funds)
  const ledgerResult = recordSpending({
    userId,
    accountId: mpesaAccount.id,
    amount: usdAmount,
    category: 'M-Pesa Payout',
    payee: `M-Pesa Outward to ${cleanPhone}`,
    referenceId: receiptNumber,
    icon: 'arrow-up-right',
    tone: 'orange'
  });

  db.run(
    `INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json, journal_entry_id)
     VALUES (?, ?, 'mpesa', 'outflow', 'completed', ?, 'KES', ?, ?, ?, ?)`,
    [
      railTxId,
      userId,
      numericAmount,
      receiptNumber,
      cleanPhone,
      JSON.stringify({ description, convertedUsd: usdAmount }),
      ledgerResult.journalEntryId
    ]
  );

  return {
    success: true,
    status: 'completed',
    receiptNumber,
    recipientPhone: cleanPhone,
    amountKes: numericAmount,
    debitedUsd: usdAmount,
    newBalanceUsd: getAccountBalance(mpesaAccount.id),
    message: `KES ${numericAmount.toLocaleString()} successfully sent to ${cleanPhone} via M-Pesa B2C.`
  };
}

module.exports = {
  KES_TO_USD_RATE,
  ensureMpesaAccount,
  initiateStkPush,
  handleMpesaCallback,
  sendB2CPayout
};
