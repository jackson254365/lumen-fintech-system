# Lumen Fintech System Architecture & Ledger Specification

## 1. Executive Summary

Lumen Finance is engineered as a production-grade, local-first computational finance platform. Unlike naive budgeting applications that store mutable account balances, Lumen is built on a **GAAP/IFRS-compliant Double-Entry Bookkeeping Ledger Core** coupled with a **Cryptographic SHA-256 Audit Hash Chain**.

Every monetary movement generates immutable debits and credits, strictly preventing unrecorded fund creation, race conditions, or undetected database tampering.

---

## 2. Double-Entry Accounting Core

### The Fundamental Accounting Equation
$$\text{Assets} = \text{Liabilities} + \text{Equity} + (\text{Revenue} - \text{Expenses})$$
$$\sum \text{Debits} \equiv \sum \text{Credits}$$

Every financial event consists of a `journal_entry` containing at least two balanced `postings`.

### Normal Balance Matrix
| Classification | Normal Balance | Increase Direction | Decrease Direction | System Examples |
| :--- | :--- | :--- | :--- | :--- |
| **Asset** | Debit | Debit | Credit | `asset:everyday`, `asset:savings`, `asset:travel` |
| **Liability** | Credit | Credit | Debit | `liability:credit_card`, `liability:loan` |
| **Equity** | Credit | Credit | Debit | `equity:opening_balance`, `equity:retained_earnings` |
| **Revenue** | Credit | Credit | Debit | `revenue:Salary`, `revenue:Freelance`, `revenue:Dividends` |
| **Expense** | Debit | Debit | Credit | `expense:Home`, `expense:Food & drink`, `expense:Transport` |

### Core Workflows

#### 1. Salary Deposit ($6,200.00)
- **Debit:** `asset:everyday` +$6,200.00 (Asset increases)
- **Credit:** `revenue:Income` +$6,200.00 (Revenue increases)
- **Balance Invariant:** $\Delta\text{Debit} = \$6,200.00$, $\Delta\text{Credit} = \$6,200.00$. Balanced.

#### 2. Merchant Spending ($84.22)
- **Debit:** `expense:Food & drink` +$84.22 (Expense increases)
- **Credit:** `asset:everyday` -$84.22 (Asset decreases)
- **Balance Invariant:** $\Delta\text{Debit} = \$84.22$, $\Delta\text{Credit} = \$84.22$. Balanced.

#### 3. Inter-Account Transfer ($500.00 from Everyday to Savings)
- **Debit:** `asset:savings` +$500.00 (Asset increases)
- **Credit:** `asset:everyday` -$500.00 (Asset decreases)
- **Balance Invariant:** $\Delta\text{Debit} = \$500.00$, $\Delta\text{Credit} = \$500.00$. Balanced.

---

## 3. Cryptographic Audit Trail & Immutability

Lumen integrates cryptographic hash chaining across all journal entries, functioning as a lightweight, tamper-evident private ledger chain.

### Hash Chaining Mathematics
$$H_0 = \text{SHA256}(\text{"GENESIS\_LUMEN\_FINTECH\_CRYPTOGRAPHIC\_LEDGER\_CHAIN\_2026"})$$
$$H_n = \text{SHA256}(H_{n-1} \parallel \text{Seq} \parallel \text{EntryID} \parallel \text{Date} \parallel \text{Description} \parallel \text{PostingsJSON})$$

- If any record, amount, or direction in `journal_entries` or `postings` is maliciously modified or corrupted, recalculating the hash chain from genesis immediately breaks at the altered sequence number.
- Verified in milliseconds via `GET /api/ledger/verify-audit` or `client.verify_cryptographic_audit()` in the Python SDK.

---

## 4. Idempotency & Concurrency Safety

Financial endpoints (`/api/transactions`, `/api/transactions/transfer`) support the `Idempotency-Key` HTTP header:
1. When a mutating request arrives, the key is checked against `idempotency_keys`.
2. If already processed within 24 hours, the cached response is replayed with the header `X-Cache-Lookup: HIT-IDEMPOTENT`.
3. Prevents duplicate charges caused by network drops, browser refreshes, or API retries.

---

## 5. Storage Engine & ACID Guarantees

- **Database:** SQLite 3.51 with Write-Ahead Logging (`WAL`).
- **Pragmas:**
  ```sql
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  ```
- **Nested Transactions:** Handled via SQLite `SAVEPOINT`, ensuring multi-step ledger operations commit atomically or roll back completely.
