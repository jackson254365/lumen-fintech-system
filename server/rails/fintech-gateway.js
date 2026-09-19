// ============================================================================
// Fintech Interoperability Gateway & Payment Link Engine
// Connects Lumen to external Fintech platforms (Wise, Revolut, PayPal, Paystack, Chipper)
// Provides unified payment links, QR code data, and merchant paybill processing
// ============================================================================
const crypto = require('crypto');
const db = require('../db');
const { recordIncome, recordSpending, getAccountBalance } = require('../ledger/ledger-core');

// Standard exchange rates for fintech multi-currency conversion
const FINTECH_RATES = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.78,
  KES: 130.0,
  UGX: 3700.0,
  GHS: 15.5,
  NGN: 1600.0,
  ZAR: 18.2
};

function ensureFintechAccount(userId) {
  let account = db.get(
    "SELECT id, name, currency FROM accounts WHERE user_id = ? AND (name LIKE '%Fintech%' OR id LIKE 'acc_fintech_%')",
    [userId]
  );

  if (!account) {
    const accountId = 'acc_fintech_' + crypto.randomBytes(4).toString('hex');
    db.run(
      `INSERT INTO accounts (id, user_id, name, type, account_class, currency, institution, initial_balance)
       VALUES (?, ?, 'Fintech Gateway Wallet', 'checking', 'asset', 'USD', 'Lumen Multi-Rail Network', 0)`,
      [accountId, userId]
    );
    account = { id: accountId, name: 'Fintech Gateway Wallet', currency: 'USD' };
  }

  return account;
}

/**
 * Generates an interactive payment link & QR code metadata for receiving funds
 * Supports M-Pesa, Airtel, Bank Wire, Wise, Revolut, and Celo Crypto
 */
function generatePaymentLink({ userId, amount, currency = 'USD', description = 'Payment Request', recipientName = 'Alex Morgan' }) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('Payment link amount must be a positive number');
  }

  const linkId = 'pay_' + crypto.randomBytes(8).toString('hex');
  const curr = currency.toUpperCase();
  const rate = FINTECH_RATES[curr] || 1.0;
  const usdAmount = Number((numericAmount / rate).toFixed(2));

  // Payment payload format for QR codes and deep links
  const qrPayload = JSON.stringify({
    scheme: 'lumen',
    payId: linkId,
    amount: numericAmount,
    currency: curr,
    recipient: recipientName
  });

  return {
    success: true,
    payLinkId: linkId,
    url: `https://pay.lumen.finance/checkout/${linkId}`,
    qrCodeData: `lumen://pay?id=${linkId}&amount=${numericAmount}&currency=${curr}`,
    amount: numericAmount,
    currency: curr,
    convertedUsd: usdAmount,
    description,
    supportedRails: ['M-PESA', 'AIRTEL_MONEY', 'SWIFT_SEPA', 'CELO_CUSD', 'WISE', 'REVOLUT'],
    message: `Payment link created. Share URL or QR code to collect ${curr} ${numericAmount.toFixed(2)}.`
  };
}

/**
 * Sends peer-to-peer or inter-fintech disbursement
 * E.g., Wise, Revolut, PayPal, Paystack, Chipper Cash
 */
function sendFintechDisbursement({ userId, platform, recipientHandle, amount, currency = 'USD', description = 'Fintech Transfer' }) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('Disbursement amount must be positive');
  }

  const plat = platform.toLowerCase();
  const curr = currency.toUpperCase();
  const rate = FINTECH_RATES[curr] || 1.0;
  const usdAmount = Number((numericAmount / rate).toFixed(2));

  const fintechAccount = ensureFintechAccount(userId);
  const currentBalance = getAccountBalance(fintechAccount.id);

  if (currentBalance < usdAmount) {
    throw new Error(`Insufficient balance in Fintech account. Available: $${currentBalance.toFixed(2)}, Requested: ${curr} ${numericAmount} ($${usdAmount})`);
  }

  const reference = `P2P_${plat.toUpperCase()}_` + Date.now() + '_' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const railTxId = 'rail_' + crypto.randomUUID();

  // Atomically debit account in double-entry ledger
  const ledgerResult = recordSpending({
    userId,
    accountId: fintechAccount.id,
    amount: usdAmount,
    category: `Fintech Payout (${platform})`,
    payee: `${platform.toUpperCase()} Outward to ${recipientHandle}`,
    referenceId: reference,
    icon: 'send',
    tone: 'orange'
  });

  db.run(
    `INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json, journal_entry_id)
     VALUES (?, ?, ?, 'outflow', 'completed', ?, ?, ?, ?, ?, ?)`,
    [
      railTxId,
      userId,
      `fintech_${plat}`,
      numericAmount,
      curr,
      reference,
      recipientHandle,
      JSON.stringify({ platform: plat, recipientHandle, description, convertedUsd: usdAmount }),
      ledgerResult.journalEntryId
    ]
  );

  return {
    success: true,
    status: 'completed',
    reference,
    platform: plat,
    recipientHandle,
    amountLocal: numericAmount,
    currency: curr,
    debitedUsd: usdAmount,
    newBalanceUsd: getAccountBalance(fintechAccount.id),
    message: `Disbursed ${curr} ${numericAmount.toFixed(2)} to ${recipientHandle} via ${platform.toUpperCase()}.`
  };
}

/**
 * Receives an inbound fintech / merchant paybill transfer
 */
function receiveFintechDeposit({ userId, platform, senderHandle, amount, currency = 'USD', reference, description = 'Inbound Fintech Payment' }) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('Inbound deposit amount must be positive');
  }

  const plat = platform.toLowerCase();
  const curr = currency.toUpperCase();
  const rate = FINTECH_RATES[curr] || 1.0;
  const usdAmount = Number((numericAmount / rate).toFixed(2));

  const fintechAccount = ensureFintechAccount(userId);
  const ref = reference || (`DEP_${plat.toUpperCase()}_` + crypto.randomBytes(4).toString('hex').toUpperCase());
  const railTxId = 'rail_' + crypto.randomUUID();

  const ledgerResult = recordIncome({
    userId,
    accountId: fintechAccount.id,
    amount: usdAmount,
    category: `Fintech Deposit (${platform})`,
    payee: `Inbound from ${senderHandle} (${platform.toUpperCase()})`,
    referenceId: ref,
    icon: 'arrow-down-left',
    tone: 'teal'
  });

  db.run(
    `INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json, journal_entry_id)
     VALUES (?, ?, ?, 'inflow', 'completed', ?, ?, ?, ?, ?, ?)`,
    [
      railTxId,
      userId,
      `fintech_${plat}`,
      numericAmount,
      curr,
      ref,
      senderHandle,
      JSON.stringify({ platform: plat, senderHandle, description, convertedUsd: usdAmount }),
      ledgerResult.journalEntryId
    ]
  );

  return {
    success: true,
    status: 'completed',
    reference: ref,
    platform: plat,
    senderHandle,
    amountLocal: numericAmount,
    currency: curr,
    creditedUsd: usdAmount,
    newBalanceUsd: getAccountBalance(fintechAccount.id),
    message: `Received ${curr} ${numericAmount.toFixed(2)} from ${senderHandle} via ${platform.toUpperCase()}.`
  };
}

module.exports = {
  FINTECH_RATES,
  ensureFintechAccount,
  generatePaymentLink,
  sendFintechDisbursement,
  receiveFintechDeposit
};
