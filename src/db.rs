// ============================================================================
// SQLite Database Adapter & Thread-Safe Connection Pool
// Pragmas: WAL mode, foreign keys enabled, busy timeout 5000ms
// ============================================================================
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Result as SqliteResult;
use std::fs;
use std::path::Path;

pub type DbPool = Pool<SqliteConnectionManager>;

pub fn init_pool(db_path: &str) -> DbPool {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(db_path).parent() {
        if !parent.exists() {
            let _ = fs::create_dir_all(parent);
        }
    }

    let manager = SqliteConnectionManager::file(db_path)
        .with_init(|conn| {
            conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA busy_timeout = 5000;",
            )
        });

    let pool = Pool::builder()
        .max_size(16)
        .build(manager)
        .expect("Failed to create SQLite connection pool");

    // Initialize Schema
    let conn = pool.get().expect("Failed to get db connection from pool");
    init_schema(&conn).expect("Failed to initialize database schema");

    pool
}

pub fn init_db(db_path: &str) -> Result<DbPool, String> {
    Ok(init_pool(db_path))
}

fn init_schema(conn: &rusqlite::Connection) -> SqliteResult<()> {
    conn.execute_batch(
        r#"
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

        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            account_class TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            institution TEXT NOT NULL DEFAULT 'Lumen Bank',
            initial_balance REAL NOT NULL DEFAULT 0.0,
            is_archived INTEGER NOT NULL DEFAULT 0,
            metadata_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS journal_entries (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            sequence_num INTEGER NOT NULL,
            date TEXT NOT NULL,
            description TEXT NOT NULL,
            reference TEXT,
            reference_id TEXT,
            prev_hash TEXT NOT NULL,
            entry_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS journal_lines (
            id TEXT PRIMARY KEY,
            journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            account_id TEXT NOT NULL,
            description TEXT NOT NULL,
            debit_amount REAL NOT NULL DEFAULT 0.0,
            credit_amount REAL NOT NULL DEFAULT 0.0,
            category TEXT NOT NULL DEFAULT 'General Expenses',
            icon TEXT NOT NULL DEFAULT 'receipt-text',
            color TEXT NOT NULL DEFAULT 'slate',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS postings (
            id TEXT PRIMARY KEY,
            journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            account_id TEXT,
            account_code TEXT NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
            amount REAL NOT NULL CHECK(amount > 0),
            currency TEXT NOT NULL DEFAULT 'USD'
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('income', 'spending', 'transfer')),
            icon TEXT NOT NULL DEFAULT 'receipt-text',
            tone TEXT NOT NULL DEFAULT 'teal',
            fingerprint TEXT,
            is_reconciled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS envelope_budgets (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category TEXT NOT NULL,
            limit_amount REAL NOT NULL CHECK(limit_amount > 0),
            current_spend REAL NOT NULL DEFAULT 0.0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, category)
        );

        CREATE TABLE IF NOT EXISTS statement_transactions (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            category TEXT NOT NULL DEFAULT 'General Expenses',
            status TEXT NOT NULL DEFAULT 'imported',
            fingerprint TEXT UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS audit_chain (
            sequence_num INTEGER PRIMARY KEY,
            block_hash TEXT NOT NULL,
            previous_block_hash TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS payment_rails_transactions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            rail TEXT NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('inflow', 'outflow')),
            status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed')),
            amount REAL NOT NULL CHECK(amount > 0),
            currency TEXT NOT NULL,
            reference TEXT NOT NULL,
            phone_or_account TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            journal_entry_id TEXT REFERENCES journal_entries(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES ('default_user', 'Default User', 'alex@lumen.finance', 'hash');
        INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES ('test_user', 'Test User', 'test@lumen.finance', 'hash');

        CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
        CREATE INDEX IF NOT EXISTS idx_journal_user_seq ON journal_entries(user_id, sequence_num);
        CREATE INDEX IF NOT EXISTS idx_postings_entry ON postings(journal_entry_id);
        CREATE INDEX IF NOT EXISTS idx_lines_entry ON journal_lines(journal_entry_id);
        CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date DESC);
        CREATE INDEX IF NOT EXISTS idx_rails_user ON payment_rails_transactions(user_id, rail, status);
        "#,
    )?;

    Ok(())
}
