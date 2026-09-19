// ============================================================================
// Payment Rails & Crypto Automated Integration & Invariant Tests
// Verifies M-Pesa, Airtel Money, Bank Wire, On-Chain Crypto, Fiat On/Off-Ramps, and Fintech Interop
// ============================================================================
const assert = require('assert');
const db = require('../server/db');
const { ensureDefaultUser } = require('../server/middleware/auth-guard');
const mpesa = require('../server/rails/mpesa');
const airtel = require('../server/rails/airtel');
const bank = require('../server/rails/bank-transfer');
const cryptoRail = require('../server/rails/crypto');
const fintech = require('../server/rails/fintech-gateway');
const { getTrialBalance, getAccountBalance } = require('../server/ledger/ledger-core');
const { verifyAuditChain } = require('../server/ledger/audit-chain');

console.log('🧪 Running tests/rails.test.js...');

// 1. Initialize environment
db.getDb();
const userId = ensureDefaultUser();

// 2. Test M-Pesa STK Push and Callback
console.log('  Testing M-Pesa STK Push & Callback...');
const stkResult = mpesa.initiateStkPush({
  userId,
  phoneNumber: '0712345678',
  amountKes: 1300,
  description: 'Test M-Pesa Deposit'
});
assert.strictEqual(stkResult.success, true);
assert.strictEqual(stkResult.status, 'pending');

const callbackResult = mpesa.handleMpesaCallback({
  Body: {
    stkCallback: {
      CheckoutRequestID: stkResult.checkoutRequestId,
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: {
        Item: [
          { Name: 'MpesaReceiptNumber', Value: 'QGH123456' },
          { Name: 'Amount', Value: 1300 },
          { Name: 'TransactionDate', Value: 20260919120000 }
        ]
      }
    }
  }
});
assert.strictEqual(callbackResult.success, true);
assert.strictEqual(callbackResult.creditedUsd, 10.00);

// 3. Test M-Pesa B2C Payout
console.log('  Testing M-Pesa B2C Payout...');
const b2cResult = mpesa.sendB2CPayout({
  userId,
  recipientPhone: '0799887766',
  amountKes: 650,
  description: 'Test Payout'
});
assert.strictEqual(b2cResult.success, true);
assert.strictEqual(b2cResult.debitedUsd, 5.00);

// 4. Test Airtel Money Push & Payout
console.log('  Testing Airtel Money Push & Payout...');
const airtelPush = airtel.initiateAirtelPush({
  userId,
  phoneNumber: '0733112233',
  amountLocal: 2600,
  currency: 'KES'
});
assert.strictEqual(airtelPush.success, true);

const airtelCb = airtel.handleAirtelCallback({
  transaction: { id: airtelPush.reference, status: 'SUCCESS' }
});
assert.strictEqual(airtelCb.success, true);
assert.strictEqual(airtelCb.creditedUsd, 20.00);

const airtelPayout = airtel.sendAirtelPayout({
  userId,
  recipientPhone: '0733112233',
  amountLocal: 1300,
  currency: 'KES'
});
assert.strictEqual(airtelPayout.success, true);

// 5. Test Bank Wire (SWIFT / SEPA / Inbound)
console.log('  Testing Bank Wire Transfer & Clearing...');
const inboundWire = bank.receiveInboundWire({
  userId,
  senderName: 'Acme Global LLC',
  senderIban: 'US1234567890',
  amountUsd: 500.00,
  reference: 'WIRE_IN_999'
});
assert.strictEqual(inboundWire.success, true);

const outboundWire = bank.initiateWireTransfer({
  userId,
  iban: 'DE89370400440532013000',
  bic: 'DEUTDEDDBSS',
  recipientName: 'Berlin Tech GmbH',
  amountUsd: 150.00,
  type: 'SEPA'
});
assert.strictEqual(outboundWire.success, true);

const wireWebhook = bank.handleBankWebhook({
  wireId: outboundWire.wireId,
  status: 'completed'
});
assert.strictEqual(wireWebhook.success, true);

// 6. Test On-Chain Crypto Wallet, Deposit, Send, and Buy/Sell On/Off-Ramps
console.log('  Testing EVM On-Chain Crypto & Fiat On/Off-Ramps...');
const wallet = cryptoRail.ensureCryptoWallet(userId, 'celo');
assert.ok(wallet.wallet.address.startsWith('0x'));

// Inbound Deposit
const cryptoDep = cryptoRail.receiveOnChainDeposit({
  userId,
  txHash: '0x' + require('crypto').randomBytes(32).toString('hex'),
  fromAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  asset: 'cUSD',
  amount: 100.0,
  network: 'celo'
});
assert.strictEqual(cryptoDep.success, true);
assert.strictEqual(cryptoDep.creditedUsd, 100.00);

// Outbound On-Chain Transfer
const cryptoSend = cryptoRail.sendOnChainCrypto({
  userId,
  recipientAddress: '0x55d398326f99059fF775485246999027B3197955',
  asset: 'cUSD',
  amount: 25.0,
  network: 'celo'
});
assert.strictEqual(cryptoSend.success, true);

// Buy Crypto with Fiat On-Ramp
const buyResult = cryptoRail.buyCryptoWithFiat({
  userId,
  fiatCurrency: 'KES',
  cryptoAsset: 'cUSD',
  fiatAmount: 6500.0, // $50 -> ~50 cUSD
  paymentRail: 'mpesa'
});
assert.strictEqual(buyResult.success, true);

// Sell Crypto for Fiat Off-Ramp
const sellResult = cryptoRail.sellCryptoForFiat({
  userId,
  cryptoAsset: 'cUSD',
  fiatCurrency: 'KES',
  cryptoAmount: 10.0,
  payoutRail: 'mpesa',
  recipientDetails: '0712345678'
});
assert.strictEqual(sellResult.success, true);

// 7. Test Fintech Gateway (Payment Links & P2P Disbursement)
console.log('  Testing Fintech Interoperability Gateway & Payment Links...');
const payLink = fintech.generatePaymentLink({
  userId,
  amount: 150.00,
  currency: 'USD',
  description: 'Invoice #1042'
});
assert.strictEqual(payLink.success, true);
assert.ok(payLink.url.includes('pay.lumen.finance'));

const p2pDeposit = fintech.receiveFintechDeposit({
  userId,
  platform: 'revolut',
  senderHandle: 'client@revolut.me',
  amount: 100.00,
  currency: 'USD'
});
assert.strictEqual(p2pDeposit.success, true);

const p2pDisbursement = fintech.sendFintechDisbursement({
  userId,
  platform: 'wise',
  recipientHandle: 'user@wise.com',
  amount: 40.00,
  currency: 'USD'
});
assert.strictEqual(p2pDisbursement.success, true);

// 8. Verify Trial Balance Equilibrium across all rail movements
console.log('  Verifying Double-Entry Equilibrium...');
const tb = getTrialBalance(userId);
assert.strictEqual(tb.balanced, true, `Trial balance unbalanced: Debits ${tb.totalDebits} !== Credits ${tb.totalCredits}`);

// 9. Verify Cryptographic SHA-256 Audit Chain Integrity
console.log('  Verifying Cryptographic Ledger Chain Integrity...');
const audit = verifyAuditChain(userId);
assert.strictEqual(audit.valid, true, `Audit verification failed: ${audit.message}`);

console.log('🎉 tests/rails.test.js PASSED!');
