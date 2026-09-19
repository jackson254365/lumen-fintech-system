-- ============================================================================
-- Lumen Finance Production Double-Entry Ledger Schema
-- Architecture: GAAP-compliant Double-Entry Bookkeeping with Cryptographic Audit Trail
-- ============================================================================

PRAGMA foreign_keys = ON;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    api_key TEXT UNIQUE,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Real Financial Accounts (Assets, Liabilities)
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'checking', 'savings', 'credit', 'investment', 'cash'
    account_class TEXT NOT NULL, -- 'asset' or 'liability'
    currency TEXT NOT NULL DEFAULT 'USD',
    institution TEXT NOT NULL DEFAULT 'Lumen Bank',
    initial_balance REAL NOT NULL DEFAULT 0.0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Journal Entries (Header table for balanced multi-leg financial transactions)
CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sequence_num INTEGER NOT NULL,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    reference_id TEXT, -- Bank transaction ID, external reference, or receipt number
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Postings (Legs of the journal entry: debits and credits)
CREATE TABLE IF NOT EXISTS postings (
    id TEXT PRIMARY KEY,
    journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id TEXT, -- User account ID if mapped to asset/liability
    account_code TEXT NOT NULL, -- 'asset:<account_id>', 'liability:<account_id>', 'expense:<category>', 'revenue:<category>', 'equity:opening'
    direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
    amount REAL NOT NULL CHECK(amount > 0),
    currency TEXT NOT NULL DEFAULT 'USD'
);

-- Cached Transaction View (High-performance query layer for user interface)
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL, -- Signed: + for deposit/inflow, - for withdrawal/spending
    type TEXT NOT NULL CHECK(type IN ('income', 'spending', 'transfer')),
    icon TEXT NOT NULL DEFAULT 'receipt-text',
    tone TEXT NOT NULL DEFAULT 'teal',
    fingerprint TEXT, -- Deduplication hash: sha256(date + payee + amount + account_id)
    is_reconciled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Budgets (Monthly envelopes with rollover support)
CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    monthly_limit REAL NOT NULL CHECK(monthly_limit > 0),
    rollover INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, category)
);

-- Payee Categorization Rules
CREATE TABLE IF NOT EXISTS categorization_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pattern TEXT NOT NULL,
    category TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Idempotency Keys (Prevent double-spending / duplicate network submissions)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    response_code INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

-- Research Audit Log for Model Inferences & Simulations
CREATE TABLE IF NOT EXISTS research_snapshots (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    snapshot_type TEXT NOT NULL, -- 'forecast', 'monte_carlo', 'health_score'
    metrics_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Crypto Wallets (Custodial & Semi-Custodial EVM / Celo deposit addresses)
CREATE TABLE IF NOT EXISTS crypto_wallets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    network TEXT NOT NULL DEFAULT 'celo', -- 'celo', 'base', 'polygon'
    address TEXT NOT NULL,
    encrypted_privkey TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, network)
);

-- External Payment Rails (M-Pesa, Airtel Money, Bank Wire/ACH, Crypto)
CREATE TABLE IF NOT EXISTS payment_rails_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rail TEXT NOT NULL, -- 'mpesa', 'airtel', 'bank_transfer', 'crypto_celo', 'crypto_erc20'
    direction TEXT NOT NULL CHECK(direction IN ('inflow', 'outflow')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed')),
    amount REAL NOT NULL CHECK(amount > 0),
    currency TEXT NOT NULL, -- 'KES', 'USD', 'cUSD', 'CELO', 'USDT', 'EUR'
    reference TEXT NOT NULL, -- e.g. M-Pesa Receipt / CheckoutRequestID or On-Chain Tx Hash
    phone_or_account TEXT, -- 254712345678, 0xAddress, IBAN, etc.
    metadata_json TEXT NOT NULL DEFAULT '{}',
    journal_entry_id TEXT REFERENCES journal_entries(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Crypto Swaps & On/Off Ramp Conversions
CREATE TABLE IF NOT EXISTS crypto_swaps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_asset TEXT NOT NULL, -- 'mpesa_kes', 'usd_bank', 'cUSD', 'CELO', 'USDT'
    to_asset TEXT NOT NULL,
    from_amount REAL NOT NULL,
    to_amount REAL NOT NULL,
    exchange_rate REAL NOT NULL,
    fee_amount REAL NOT NULL DEFAULT 0.0,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for lightning-fast lookups
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_user_seq ON journal_entries(user_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_postings_entry ON postings(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_postings_account ON postings(account_id);
CREATE INDEX IF NOT EXISTS idx_postings_code ON postings(account_code);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions(user_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_rules_user ON categorization_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON crypto_wallets(user_id, network);
CREATE INDEX IF NOT EXISTS idx_rails_user ON payment_rails_transactions(user_id, rail, status);
CREATE INDEX IF NOT EXISTS idx_rails_ref ON payment_rails_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_swaps_user ON crypto_swaps(user_id);

