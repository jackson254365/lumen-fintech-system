# Lumen Finance · Production Rust Fintech System & Web3 Engine

[![CI Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](tests/rust_integration_test.rs)
[![Engine](https://img.shields.io/badge/engine-Rust%20(Axum%20%7C%20Tokio)-orange.svg)](src/)
[![Architecture](https://img.shields.io/badge/architecture-GAAP%20Double--Entry-blue.svg)](FINTECH_ARCHITECTURE.md)
[![Audit](https://img.shields.io/badge/audit-Cryptographic%20SHA--256-teal.svg)](src/ledger/audit_chain.rs)
[![Precision](https://img.shields.io/badge/precision-128--bit%20rust__decimal-purple.svg)](src/ledger/core.rs)

Lumen Finance is an enterprise-grade, local-first personal and commercial finance system built in **Rust**. Built on a **GAAP/IFRS-compliant double-entry accounting ledger** operating on **128-bit fixed-point precision (`rust_decimal`)** with a **cryptographic SHA-256 hash-chained audit trail**, Lumen eliminates floating-point rounding errors and reconciliation drift.

It features a multi-rail payment system (**M-Pesa**, **Airtel Money**, **ISO 20022 SWIFT/SEPA/ACH Bank Wires**, **Celo EVM Web3 Crypto Rail**, and **Fintech Gateways**) and a computational finance research suite featuring **cash flow forecasting**, **Monte Carlo runway stress-testing**, **bank statement deduplication**, and a **Python Research SDK**.

---

## ⚡ Quick Start

### 1. Prerequisites
- **Rust**: `1.80+` (edition 2021)
- **Node.js**: `v20+` (optional, for frontend static web client / legacy scripts)
- **Python**: `v3.8+` (for research SDK)

### 2. Run Rust Server
```bash
# Clone or navigate to the directory
cd /home/arch/Documents/Codex/2026-09-08/lumen-fintech-system

# Run automated Rust integration tests
cargo test

# Launch production server in release mode
cargo run --release
```
Open **`http://localhost:3000`** in your browser.

---

## 🐳 Docker Deployment

Run with one command using Docker Compose:
```bash
docker-compose up -d --build
```
Your SQLite database and cryptographic ledger state persist automatically in the `lumen-data` volume.

---

## 📐 Core Capabilities

### 1. Double-Entry Accounting Core in Rust
- **128-bit Fixed-Point Precision:** Uses `rust_decimal` for zero floating-point drift.
- **Mathematical debit-credit conservation:** Every transaction enforces $\sum \text{Debits} \equiv \sum \text{Credits}$.
- **Chart of Accounts:** Assets, Liabilities, Equity, Revenue, and Expense classes.
- **GAAP Financial Statements:** Real-time generation of Trial Balance, Balance Sheet, and Income Statement (P&L).

### 2. Cryptographic SHA-256 Audit Trail
- Each journal entry computes $H_n = \text{SHA256}(H_{n-1} \parallel \text{Seq} \parallel \text{EntryID} \parallel \text{Date} \parallel \text{Description} \parallel \text{SortedPostingsJSON})$.
- Provides zero-knowledge mathematical proof of data integrity.
- Any manual database tampering immediately flags the corrupted sequence block.

### 3. Multi-Rail Payment Gateway & Celo Web3 Crypto Engine
- **M-Pesa Rail**: Safaricom Daraja STK Push prompt & automated B2C payouts.
- **Airtel Money Rail**: East African mobile money collections and disbursements.
- **ISO 20022 Bank Wires**: SWIFT, SEPA, and ACH wire transfers.
- **Celo EVM Web3 Crypto Engine**: On-chain cUSD, CELO, USDC, BTC, and ETH deposits/withdrawals, min deposit validation ($0.01 limit), on-ramp/off-ramp buy & sell orders, and DEX swaps.
- **Fintech Gateways**: Wise, Revolut, PayPal, and Paystack P2P & payment links.

### 4. Bank Statement Ingestion Engine
- Parses CSV (Chase, Monzo, Starling, Revolut) and banking OFX/QFX files.
- Exact SHA-256 fingerprinting + fuzzy temporal deduplication.

### 5. Computational Finance Research Engine
- **Cash Flow Forecasting**: 30/60/90-day trend projections.
- **Monte Carlo Runway Stress-Testing**: Stochastic Box-Muller simulation modeling revenue volatility, expense shocks, and insolvency probability.
- **Financial Health Score**: Altman Z-Score liquidity diagnostic engine (0-100 rating).
- **Fraud Anomaly Detection**: Z-Score outlier detection for unexpected cash drain.

---

## 🛠️ API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/system/health` | Rust system health check, SQLite metrics, and uptime |
| `GET` | `/api/accounts` | Connected accounts with live calculated balances |
| `POST` | `/api/accounts` | Create account with opening equity balance |
| `GET` | `/api/transactions` | Query and filter transactions (`limit`, `search`, `category`) |
| `POST` | `/api/transactions` | Post spending or deposit to double-entry ledger |
| `POST` | `/api/transactions/transfer` | Execute inter-account balanced transfer |
| `GET` | `/api/ledger/trial-balance` | GAAP trial balance verifying debit-credit equilibrium |
| `GET` | `/api/ledger/verify-audit` | Verify SHA-256 cryptographic audit chain from genesis |
| `POST` | `/api/rails/mpesa/stk-push` | Dispatch M-Pesa STK Push prompt |
| `POST` | `/api/rails/mpesa/b2c` | Send M-Pesa B2C payout |
| `POST` | `/api/rails/airtel/collection` | Dispatch Airtel Money collection prompt |
| `POST` | `/api/rails/airtel/disbursement` | Send Airtel Money disbursement |
| `POST` | `/api/rails/bank/wire` | Initiate SWIFT / SEPA / ACH wire transfer |
| `GET` | `/api/rails/crypto/prices` | Get real-time crypto prices (cUSD, CELO, USDC, BTC, ETH) |
| `GET` | `/api/rails/crypto/wallet` | Get or create Web3 wallet address |
| `POST` | `/api/rails/crypto/receive` | Receive on-chain crypto deposit |
| `POST` | `/api/rails/crypto/send` | Send outward on-chain crypto transfer |
| `POST` | `/api/rails/crypto/buy` | Fiat on-ramp crypto buy order |
| `POST` | `/api/rails/crypto/sell` | Crypto off-ramp sell order |
| `POST` | `/api/rails/crypto/swap` | Execute instant crypto swap |
| `POST` | `/api/statements/parse` | Parse CSV/OFX statement upload |
| `GET` | `/api/research/forecast` | Cash flow projections |
| `POST` | `/api/research/monte-carlo` | Run Monte Carlo runway stress simulation |
| `GET` | `/api/research/health-score` | Calculate 0-100 financial health score |
