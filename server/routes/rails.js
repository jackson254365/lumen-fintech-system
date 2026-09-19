// ============================================================================
// Payment Rails REST Routes
// Endpoints for M-Pesa, Airtel Money, Bank Wire, Crypto/Celo On-Chain Swaps, & Fintech Interop
// ============================================================================
const express = require('express');
const router = express.Router();
const db = require('../db');

// Rail connectors
const mpesa = require('../rails/mpesa');
const airtel = require('../rails/airtel');
const bank = require('../rails/bank-transfer');
const cryptoRail = require('../rails/crypto');
const fintech = require('../rails/fintech-gateway');

// ─────────────────────────────────────────────────────────────────
// M-PESA ENDPOINTS
// ─────────────────────────────────────────────────────────────────

router.post('/mpesa/stk-push', (req, res, next) => {
  try {
    const { phoneNumber, amountKes, description } = req.body;
    if (!phoneNumber || !amountKes) {
      return res.status(400).json({ success: false, error: 'phoneNumber and amountKes are required' });
    }
    const result = mpesa.initiateStkPush({ userId: req.user.id, phoneNumber, amountKes, description });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/mpesa/callback', (req, res, next) => {
  try {
    const result = mpesa.handleMpesaCallback(req.body);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted', ...result });
  } catch (err) {
    console.error('[M-Pesa Callback Error]', err.message);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

router.post('/mpesa/b2c', (req, res, next) => {
  try {
    const { recipientPhone, amountKes, description } = req.body;
    if (!recipientPhone || !amountKes) {
      return res.status(400).json({ success: false, error: 'recipientPhone and amountKes are required' });
    }
    const result = mpesa.sendB2CPayout({ userId: req.user.id, recipientPhone, amountKes, description });
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────
// AIRTEL MONEY ENDPOINTS
// ─────────────────────────────────────────────────────────────────

router.post('/airtel/push', (req, res, next) => {
  try {
    const { phoneNumber, amountLocal, currency = 'KES', description } = req.body;
    if (!phoneNumber || !amountLocal) {
      return res.status(400).json({ success: false, error: 'phoneNumber and amountLocal are required' });
    }
    const result = airtel.initiateAirtelPush({ userId: req.user.id, phoneNumber, amountLocal, currency, description });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/airtel/callback', (req, res, next) => {
  try {
    const result = airtel.handleAirtelCallback(req.body);
    res.json({ status: 'received', ...result });
  } catch (err) {
    console.error('[Airtel Callback Error]', err.message);
    res.json({ status: 'received' });
  }
});

router.post('/airtel/payout', (req, res, next) => {
  try {
    const { recipientPhone, amountLocal, currency = 'KES', description } = req.body;
    if (!recipientPhone || !amountLocal) {
      return res.status(400).json({ success: false, error: 'recipientPhone and amountLocal are required' });
    }
    const result = airtel.sendAirtelPayout({ userId: req.user.id, recipientPhone, amountLocal, currency, description });
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────
// BANK TRANSFER ENDPOINTS
// ─────────────────────────────────────────────────────────────────

router.post('/bank/wire', (req, res, next) => {
  try {
    const { iban, bic, recipientName, amountUsd, description, type = 'SWIFT' } = req.body;
    if (!iban || !recipientName || !amountUsd) {
      return res.status(400).json({ success: false, error: 'iban, recipientName, and amountUsd are required' });
    }
    const result = bank.initiateWireTransfer({ userId: req.user.id, iban, bic, recipientName, amountUsd, description, type });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/bank/receive', (req, res, next) => {
  try {
    const { senderName, senderIban, amountUsd, reference, description } = req.body;
    if (!senderName || !amountUsd) {
      return res.status(400).json({ success: false, error: 'senderName and amountUsd are required' });
    }
    const result = bank.receiveInboundWire({ userId: req.user.id, senderName, senderIban, amountUsd, reference, description });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/bank/webhook', (req, res, next) => {
  try {
    const result = bank.handleBankWebhook(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/bank/wire/:wireId', (req, res, next) => {
  try {
    const status = bank.getWireStatus(req.params.wireId);
    if (!status) return res.status(404).json({ success: false, error: 'Wire transfer not found' });
    res.json({ success: true, wire: status });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────
// CRYPTO / ON-CHAIN ENDPOINTS
// ─────────────────────────────────────────────────────────────────

router.get('/crypto/wallet', (req, res, next) => {
  try {
    const { network = 'celo' } = req.query;
    const info = cryptoRail.ensureCryptoWallet(req.user.id, network);
    res.json({
      success: true,
      network: info.wallet.network,
      address: info.wallet.address,
      createdAt: info.wallet.created_at,
      ledgerAccount: info.ledgerAccount
    });
  } catch (err) { next(err); }
});

router.post('/crypto/send', (req, res, next) => {
  try {
    const { recipientAddress, asset, amount, network = 'celo' } = req.body;
    if (!recipientAddress || !amount) {
      return res.status(400).json({ success: false, error: 'recipientAddress and amount are required' });
    }
    const result = cryptoRail.sendOnChainCrypto({ userId: req.user.id, recipientAddress, asset, amount, network });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/crypto/receive', (req, res, next) => {
  try {
    const { txHash, fromAddress, asset, amount, network = 'celo' } = req.body;
    if (!amount) {
      return res.status(400).json({ success: false, error: 'amount is required' });
    }
    const result = cryptoRail.receiveOnChainDeposit({ userId: req.user.id, txHash, fromAddress, asset, amount, network });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/crypto/buy', (req, res, next) => {
  try {
    const { fiatCurrency = 'KES', cryptoAsset = 'cUSD', fiatAmount, paymentRail = 'mpesa' } = req.body;
    if (!fiatAmount) {
      return res.status(400).json({ success: false, error: 'fiatAmount is required' });
    }
    const result = cryptoRail.buyCryptoWithFiat({ userId: req.user.id, fiatCurrency, cryptoAsset, fiatAmount, paymentRail });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/crypto/sell', (req, res, next) => {
  try {
    const { cryptoAsset = 'cUSD', fiatCurrency = 'KES', cryptoAmount, payoutRail = 'mpesa', recipientDetails } = req.body;
    if (!cryptoAmount) {
      return res.status(400).json({ success: false, error: 'cryptoAmount is required' });
    }
    const result = cryptoRail.sellCryptoForFiat({ userId: req.user.id, cryptoAsset, fiatCurrency, cryptoAmount, payoutRail, recipientDetails });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/crypto/swap', (req, res, next) => {
  try {
    const { fromAsset, toAsset, fromAmount } = req.body;
    if (!fromAsset || !toAsset || !fromAmount) {
      return res.status(400).json({ success: false, error: 'fromAsset, toAsset, and fromAmount are required' });
    }
    const result = cryptoRail.executeCryptoSwap({ userId: req.user.id, fromAsset, toAsset, fromAmount });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/crypto/rates', (req, res) => {
  res.json({ success: true, ...cryptoRail.getCryptoRates() });
});

// ─────────────────────────────────────────────────────────────────
// FINTECH INTEROPERABILITY & PAYMENT LINK ENDPOINTS
// ─────────────────────────────────────────────────────────────────

router.post('/fintech/paylink', (req, res, next) => {
  try {
    const { amount, currency = 'USD', description, recipientName } = req.body;
    if (!amount) return res.status(400).json({ success: false, error: 'amount is required' });
    const result = fintech.generatePaymentLink({ userId: req.user.id, amount, currency, description, recipientName: recipientName || req.user.name });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/fintech/send-p2p', (req, res, next) => {
  try {
    const { platform = 'wise', recipientHandle, amount, currency = 'USD', description } = req.body;
    if (!recipientHandle || !amount) {
      return res.status(400).json({ success: false, error: 'recipientHandle and amount are required' });
    }
    const result = fintech.sendFintechDisbursement({ userId: req.user.id, platform, recipientHandle, amount, currency, description });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/fintech/receive', (req, res, next) => {
  try {
    const { platform = 'revolut', senderHandle, amount, currency = 'USD', reference, description } = req.body;
    if (!senderHandle || !amount) {
      return res.status(400).json({ success: false, error: 'senderHandle and amount are required' });
    }
    const result = fintech.receiveFintechDeposit({ userId: req.user.id, platform, senderHandle, amount, currency, reference, description });
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────
// UNIFIED TRANSACTION HISTORY & SUMMARY
// ─────────────────────────────────────────────────────────────────

router.get('/transactions', (req, res, next) => {
  try {
    const { rail, direction, status, limit = 50, offset = 0 } = req.query;
    let sql = 'SELECT * FROM payment_rails_transactions WHERE user_id = ?';
    const params = [req.user.id];

    if (rail) { sql += ' AND rail = ?'; params.push(rail); }
    if (direction) { sql += ' AND direction = ?'; params.push(direction); }
    if (status) { sql += ' AND status = ?'; params.push(status); }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const transactions = db.query(sql, params);
    const parsed = transactions.map(tx => ({ ...tx, metadata: tx.metadata_json ? JSON.parse(tx.metadata_json) : {} }));

    res.json({ success: true, count: parsed.length, transactions: parsed });
  } catch (err) { next(err); }
});

router.get('/summary', (req, res, next) => {
  try {
    const summary = db.query(
      `SELECT rail, direction, status, COUNT(*) as count, SUM(amount) as total_local, currency
       FROM payment_rails_transactions WHERE user_id = ? GROUP BY rail, direction, status, currency ORDER BY rail, direction`,
      [req.user.id]
    );
    res.json({ success: true, summary });
  } catch (err) { next(err); }
});

module.exports = router;
