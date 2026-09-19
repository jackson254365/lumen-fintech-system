# Lumen Finance · Production Fintech System & Research Platform

[![CI Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](tests/)
[![Architecture](https://img.shields.io/badge/architecture-GAAP%20Double--Entry-blue.svg)](FINTECH_ARCHITECTURE.md)
[![Audit](https://img.shields.io/badge/audit-Cryptographic%20SHA--256-teal.svg)](server/ledger/audit-chain.js)
[![Research](https://img.shields.io/badge/research-Monte%20Carlo%20%7C%20Holt--Winters-purple.svg)](RESEARCH_METHODOLOGY.md)

Lumen Finance is an enterprise-grade, local-first personal and commercial finance system. Built on a **GAAP/IFRS-compliant double-entry accounting ledger** with a **cryptographic SHA-256 hash-chained audit trail**, Lumen eliminates the data loss and reconciliation errors typical of naive budgeting apps. It includes a computational finance research suite featuring **Holt-Winters cash flow forecasting**, **Monte Carlo runway stress-testing**, **bank statement deduplication**, and a **Python Research SDK**.

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: v20+ or v22+
- **Python**: v3.8+ (for research scripts and Jupyter notebooks)

### 2. Installation & Run
```bash
# Clone or navigate to the directory
cd /home/arch/Documents/Codex/2026-09-08/lumen-fintech-system

# Install dependencies (Express, CORS, Multer)
npm install

# Run automated test suite (verifies accounting invariants and audit chain)
npm test

# Start production server
npm start
```
Open **`http://localhost:3000`** in your browser.

---

## 🐳 Docker Deployment

Run with one command using Docker Compose:
```bash
docker-compose up -d
```
Your SQLite database and cryptographic ledger state persist automatically in the `lumen-data` volume.

---

## 📐 Core Capabilities

### 1. Double-Entry Accounting Core
- **Mathematical debit-credit conservation:** Every transaction enforces $\sum \text{Debits} \equiv \sum \text{Credits}$.
- **Chart of Accounts:** Assets, Liabilities, Equity, Revenue, and Expense classes.
- **GAAP Financial Statements:** Real-time generation of Trial Balance, Balance Sheet, and Income Statement (P&L).
- **Overdraft Protection:** Prevents asset accounts from dropping below zero without an authorized credit facility.

### 2. Cryptographic SHA-256 Audit Trail
- Each journal entry computes $H_n = \text{SHA256}(H_{n-1} \parallel \text{EntryData})$.
- Provides zero-knowledge mathematical proof of data integrity.
- Any manual database tampering or row modification immediately flags the corrupted sequence block.

### 3. Bank Statement Ingestion Engine
- **Universal Format Support:** Parses CSV (Chase, Monzo, Starling, Revolut) and banking OFX/QFX files.
- **Cryptographic Deduplication:** Deterministic SHA-256 fingerprinting prevents duplicate entries across overlapping monthly statements.
- **Rule-Based & Heuristic Categorization:** Categorizes payees with instant icon and tone mapping.

### 4. Computational Finance Research Core
- **Time-Series Cash Flow Forecasting:** Holt-Winters Double Exponential Smoothing with dynamic 80% and 95% confidence bands.
- **Monte Carlo Runway Stress Simulation:** Runs 1,000 stochastic trajectories modeling income shocks (-50% to +20%), inflation variance, and Poisson emergency expenses.
- **Financial Health Index (0-100):** Algorithmic scoring across 5 macroeconomic pillars (Savings Rate, Emergency Runway, Debt Leverage, Budget Discipline, Income Stability).
- **Recurring Subscription Detection:** Detects cadences and annual burn rates for fixed bills.
- **Outlier Spending Detection:** Rolling Z-score and IQR anomaly detection.

---

## 🐍 Python Research SDK

Empowers quantitative analysts, econometricians, and data scientists to stream live ledger data directly into Pandas:

```python
from sdk.research_client import LumenClient

client = LumenClient(base_url="http://localhost:3000")

# 1. Verify cryptographic ledger
audit = client.verify_cryptographic_audit()
print("Audit:", audit["audit"]["message"])

# 2. Run Monte Carlo stress simulation
sim = client.run_monte_carlo_simulation(
    iterations=1000,
    horizon_months=12,
    income_shock_pct=-20.0,
    emergency_shock_amount=3000.0
)
print("Solvency Probability:", sim["simulation"]["results"]["solvencyProbability"], "%")

# 3. Stream transactions into pandas DataFrame
df = client.get_transactions_dataframe()
print(df.groupby("category")["amount"].sum())
```

---

## 📡 REST API Reference

All requests accept and return JSON. Supports `x-api-key: your_key` and `Idempotency-Key` headers.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/system/health` | System health check, SQLite metrics, and uptime |
| `GET` | `/api/accounts` | Connected accounts with live calculated balances |
| `POST` | `/api/accounts` | Create account with opening equity balance |
| `GET` | `/api/transactions` | Query and filter transactions (`type`, `search`, `limit`) |
| `POST` | `/api/transactions` | Post spending or deposit to double-entry ledger |
| `POST` | `/api/transactions/transfer` | Execute inter-account balanced transfer |
| `GET` | `/api/budgets` | Monthly envelope budgets with current spend |
| `GET` | `/api/ledger/trial-balance` | GAAP trial balance verifying debit-credit equilibrium |
| `GET` | `/api/ledger/verify-audit` | Verify SHA-256 cryptographic audit chain from genesis |
| `POST` | `/api/statements/parse` | Parse and deduplicate CSV/OFX statement upload |
| `POST` | `/api/statements/commit` | Commit reviewed statement batch to ledger |
| `GET` | `/api/research/forecast` | Holt-Winters cash flow forecast with confidence bounds |
| `POST` | `/api/research/monte-carlo` | Run stochastic runway simulation with stress parameters |
| `GET` | `/api/research/health-score` | 5-Pillar econometric health score & recommendations |
| `GET` | `/api/research/subscriptions` | Detected recurring services and annual burn rates |
| `GET` | `/api/research/anomalies` | Statistical spending outlier detection |
| `GET` | `/api/system/export` | Download full ledger JSON backup |

---

## 📂 Architecture & Directory Structure

```
lumen-fintech-system/
├── server/
│   ├── index.js                  # Production Express REST API entrypoint
│   ├── config.js                 # Configuration constants & environment flags
│   ├── db.js                     # SQLite WAL mode adapter with SAVEPOINT nesting
│   ├── schema.sql                # Double-entry ledger schema & indexes
│   ├── ledger/
│   │   ├── ledger-core.js        # Double-entry bookkeeping engine
│   │   ├── chart-of-accounts.js  # 5 standard accounting classifications
│   │   └── audit-chain.js        # SHA-256 cryptographic hash-chaining verification
│   ├── statement-engine/
│   │   ├── parser.js             # CSV & OFX multi-bank statement parser
│   │   ├── deduplicator.js       # SHA-256 fingerprinting deduplicator
│   │   └── categorizer.js        # Rule-based & heuristic payee categorizer
│   ├── research-engine/
│   │   ├── forecast.js           # Holt-Winters cash flow forecasting
│   │   ├── monte-carlo.js        # 1,000-iteration stochastic runway simulator
│   │   ├── health-score.js       # Econometric health scoring engine (0-100)
│   │   ├── subscriptions.js      # Recurring bill & subscription detector
│   │   ├── anomaly-detector.js   # Rolling Z-score anomaly detector
│   │   └── currency.js           # Multi-currency cross-rate converter
│   ├── routes/                   # Modular REST API route handlers
│   └── middleware/               # Auth guard, idempotency, and error handling
├── client / frontend
│   ├── index.html                # Upgraded responsive UI with Lucide icons
│   ├── styles.css                # Polished design system with research widgets
│   └── app.js                    # Reactive frontend with live API client
├── tests/
│   ├── ledger.test.js            # Invariant, overdraft, and balance tests
│   ├── audit-chain.test.js       # Cryptographic integrity and tamper detection tests
│   ├── statement-parser.test.js  # CSV/OFX parsing and deduplication tests
│   ├── research-engine.test.js   # Forecast and Monte Carlo mathematical tests
│   └── api.test.js               # E2E REST API and idempotency tests
├── sdk/
│   └── research_client.py        # Python SDK for data scientists
├── Dockerfile                    # Multi-stage production container build
├── docker-compose.yml            # Container orchestration with volume persistence
├── lumen.service                 # Linux systemd service unit
├── FINTECH_ARCHITECTURE.md       # Technical ledger specifications
└── RESEARCH_METHODOLOGY.md       # Mathematical formulations for research models
```

---

## 🧪 Testing

Execute the comprehensive test suite verifying accounting invariants, cryptographic hashing, statement parsing, and Monte Carlo algorithms:
```bash
npm test
```
Result:
```
✓ Correctly rejected unbalanced journal entry
✓ Income recorded and balance accurately updated
✓ Spending deducted and balance accurately updated
✓ Overdraft protection enforced
✓ Inter-account transfer balanced and executed
✓ Trial Balance verified: $1450 Debits === $1450 Credits
✓ Cryptographic hash chain verified (3 entries)
✓ Tamper successfully detected at sequence #2
✓ Standard 3-column CSV parsed accurately
✓ Semicolon-delimited dual Debit/Credit CSV parsed accurately
✓ Standard banking OFX/QFX statement parsed accurately
✓ Deduplication fingerprints are deterministic and collision-resistant
✓ Holt-Winters Double Exponential Smoothing generated trending forecast with confidence bands
✓ Monte Carlo simulation executed 500 stochastic paths (Solvency: 100%, Rating: Ultra-Resilient (AAA))
✓ Financial Health Index calculated: 99/100 (Grade: A+) across 5 econometric pillars
✓ Idempotency-Key successfully prevented double-spending
```

---

## 📄 License
MIT License. Built for production personal finance, commercial ledger compliance, and quantitative financial research.
