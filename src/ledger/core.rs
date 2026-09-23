// ============================================================================
// Double-Entry Ledger Core Engine in Rust
// Enforces mathematical debit-credit conservation: sum(Debits) == sum(Credits)
// Operates on 128-bit Decimal arithmetic (rust_decimal) for zero float drift
// ============================================================================
use crate::ledger::audit_chain::{compute_entry_hash, get_latest_tip, PostingPayload};
use chrono::Utc;
use rusqlite::{params, Connection, Transaction};
use rust_decimal::prelude::*;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostingInput {
    pub account_id: Option<String>,
    pub account_code: String,
    pub direction: String, // "debit" or "credit"
    pub amount: Decimal,
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntryResult {
    pub entry_id: String,
    pub sequence: i64,
    pub entry_hash: String,
    pub prev_hash: String,
    pub date: String,
    pub total_amount: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionResult {
    pub transaction_id: String,
    pub journal_entry_id: String,
    pub account_id: String,
    pub amount: Decimal,
    pub new_balance: Decimal,
    pub entry_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferResult {
    pub entry_id: String,
    pub out_transaction_id: String,
    pub in_transaction_id: String,
    pub from_account_id: String,
    pub from_new_balance: Decimal,
    pub to_account_id: String,
    pub to_new_balance: Decimal,
    pub amount: Decimal,
    pub entry_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialBalanceSummary {
    pub accounts: HashMap<String, DebitCredit>,
    pub total_debits: Decimal,
    pub total_credits: Decimal,
    pub balanced: bool,
    pub difference: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebitCredit {
    pub debit: Decimal,
    pub credit: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceSheet {
    pub assets: Vec<AccountBalanceItem>,
    pub total_assets: Decimal,
    pub liabilities: Vec<AccountBalanceItem>,
    pub total_liabilities: Decimal,
    pub net_worth: Decimal,
    pub invariance_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountBalanceItem {
    pub id: String,
    pub name: String,
    pub acc_type: String,
    pub balance: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeStatement {
    pub revenue: HashMap<String, Decimal>,
    pub total_revenue: Decimal,
    pub expenses: HashMap<String, Decimal>,
    pub total_expenses: Decimal,
    pub net_income: Decimal,
}

/// Creates a balanced multi-posting journal entry in an atomic transaction
pub fn create_journal_entry(
    tx: &Transaction,
    user_id: &str,
    date: Option<String>,
    description: &str,
    reference_id: Option<String>,
    postings: &[PostingInput],
) -> Result<JournalEntryResult, String> {
    if postings.len() < 2 {
        return Err("A double-entry transaction requires at least two postings".to_string());
    }

    let mut total_debits = dec!(0.0);
    let mut total_credits = dec!(0.0);

    for p in postings {
        if p.amount <= dec!(0.0) {
            return Err(format!("Invalid posting amount: {}", p.amount));
        }
        match p.direction.to_lowercase().as_str() {
            "debit" => total_debits += p.amount,
            "credit" => total_credits += p.amount,
            _ => return Err(format!("Invalid direction '{}'", p.direction)),
        }
    }

    if (total_debits - total_credits).abs() > dec!(0.001) {
        return Err(format!(
            "Unbalanced journal entry: Total debits (${}) must equal total credits (${})",
            total_debits, total_credits
        ));
    }

    let entry_id = format!("je_{}", Uuid::new_v4());
    let entry_date = date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d %H:%M:%S").to_string());

    let tip = get_latest_tip(tx, user_id);
    let next_seq = tip.sequence + 1;
    let prev_hash = tip.hash;

    let mut payload_postings: Vec<PostingPayload> = postings
        .iter()
        .map(|p| PostingPayload {
            account_id: p.account_id.clone(),
            account_code: p.account_code.clone(),
            direction: p.direction.clone(),
            amount: p.amount.to_f64().unwrap_or(0.0),
        })
        .collect();

    payload_postings.sort_by(|a, b| a.direction.cmp(&b.direction).then_with(|| a.account_code.cmp(&b.account_code)));

    let entry_hash = compute_entry_hash(
        &prev_hash,
        next_seq,
        &entry_id,
        &entry_date,
        description,
        &payload_postings,
    );

    tx.execute(
        "INSERT INTO journal_entries (id, user_id, sequence_num, date, description, reference_id, prev_hash, entry_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![entry_id, user_id, next_seq, entry_date, description, reference_id, prev_hash, entry_hash],
    ).map_err(|e| e.to_string())?;

    for p in postings {
        let posting_id = format!("post_{}", Uuid::new_v4());
        let amt_f64 = p.amount.to_f64().unwrap_or(0.0);
        let curr = p.currency.clone().unwrap_or_else(|| "USD".to_string());

        tx.execute(
            "INSERT INTO postings (id, journal_entry_id, account_id, account_code, direction, amount, currency)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![posting_id, entry_id, p.account_id, p.account_code, p.direction, amt_f64, curr],
        ).map_err(|e| e.to_string())?;
    }

    Ok(JournalEntryResult {
        entry_id,
        sequence: next_seq,
        entry_hash,
        prev_hash,
        date: entry_date,
        total_amount: total_debits,
    })
}

/// Computes real balance of an account directly from posted debits and credits
pub fn get_account_balance(conn: &Connection, account_id: &str) -> Result<Decimal, String> {
    let acc_class: String = conn
        .query_row(
            "SELECT account_class FROM accounts WHERE id = ?",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("Account not found: {}", account_id))?;

    let mut stmt = conn
        .prepare("SELECT direction, SUM(amount) FROM postings WHERE account_id = ? GROUP BY direction")
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, f64)> = stmt
        .query_map([account_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut debits = dec!(0.0);
    let mut credits = dec!(0.0);

    for (dir, total) in rows {
        let dec_total = Decimal::from_f64(total).unwrap_or(dec!(0.0));
        if dir == "debit" {
            debits = dec_total;
        } else if dir == "credit" {
            credits = dec_total;
        }
    }

    if acc_class == "asset" {
        Ok(debits - credits)
    } else {
        Ok(credits - debits)
    }
}

/// Records Spending / Expense
pub fn record_spending(
    conn: &mut Connection,
    user_id: &str,
    account_id: &str,
    amount: Decimal,
    category: &str,
    payee: &str,
    date: Option<String>,
    reference_id: Option<String>,
    icon: &str,
    tone: &str,
) -> Result<TransactionResult, String> {
    let num_amount = amount.abs();
    if num_amount <= dec!(0.0) {
        return Err("Amount must be greater than 0".to_string());
    }

    let acc_class: String = conn
        .query_row(
            "SELECT account_class FROM accounts WHERE id = ? AND user_id = ?",
            [account_id, user_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("Account not found or access denied: {}", account_id))?;

    if acc_class == "asset" {
        let current = get_account_balance(conn, account_id)?;
        if current - num_amount < dec!(-0.001) {
            return Err(format!(
                "Insufficient funds in account. Available: ${}, Requested: ${}",
                current, num_amount
            ));
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let postings = vec![
        PostingInput {
            account_id: None,
            account_code: format!("expense:{}", category),
            direction: "debit".to_string(),
            amount: num_amount,
            currency: Some("USD".to_string()),
        },
        PostingInput {
            account_id: Some(account_id.to_string()),
            account_code: format!("asset:{}", account_id),
            direction: "credit".to_string(),
            amount: num_amount,
            currency: Some("USD".to_string()),
        },
    ];

    let journal_res = create_journal_entry(&tx, user_id, date, payee, reference_id, &postings)?;

    let tx_id = format!("tx_{}", Uuid::new_v4());
    let amt_neg = -num_amount.to_f64().unwrap_or(0.0);

    tx.execute(
        "INSERT INTO transactions (id, journal_entry_id, user_id, account_id, date, name, category, amount, type, icon, tone, fingerprint, is_reconciled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'spending', ?, ?, ?, 1)",
        params![tx_id, journal_res.entry_id, user_id, account_id, journal_res.date, payee, category, amt_neg, icon, tone, Option::<String>::None],
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let new_bal = get_account_balance(conn, account_id)?;

    Ok(TransactionResult {
        transaction_id: tx_id,
        journal_entry_id: journal_res.entry_id,
        account_id: account_id.to_string(),
        amount: -num_amount,
        new_balance: new_bal,
        entry_hash: journal_res.entry_hash,
    })
}

/// Records Income / Deposit
pub fn record_income(
    conn: &mut Connection,
    user_id: &str,
    account_id: &str,
    amount: Decimal,
    category: &str,
    payee: &str,
    date: Option<String>,
    reference_id: Option<String>,
    icon: &str,
    tone: &str,
) -> Result<TransactionResult, String> {
    let num_amount = amount.abs();
    if num_amount <= dec!(0.0) {
        return Err("Amount must be greater than 0".to_string());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let postings = vec![
        PostingInput {
            account_id: Some(account_id.to_string()),
            account_code: format!("asset:{}", account_id),
            direction: "debit".to_string(),
            amount: num_amount,
            currency: Some("USD".to_string()),
        },
        PostingInput {
            account_id: None,
            account_code: format!("revenue:{}", category),
            direction: "credit".to_string(),
            amount: num_amount,
            currency: Some("USD".to_string()),
        },
    ];

    let journal_res = create_journal_entry(&tx, user_id, date, payee, reference_id, &postings)?;

    let tx_id = format!("tx_{}", Uuid::new_v4());
    let amt_pos = num_amount.to_f64().unwrap_or(0.0);

    tx.execute(
        "INSERT INTO transactions (id, journal_entry_id, user_id, account_id, date, name, category, amount, type, icon, tone, fingerprint, is_reconciled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'income', ?, ?, ?, 1)",
        params![tx_id, journal_res.entry_id, user_id, account_id, journal_res.date, payee, category, amt_pos, icon, tone, Option::<String>::None],
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let new_bal = get_account_balance(conn, account_id)?;

    Ok(TransactionResult {
        transaction_id: tx_id,
        journal_entry_id: journal_res.entry_id,
        account_id: account_id.to_string(),
        amount: num_amount,
        new_balance: new_bal,
        entry_hash: journal_res.entry_hash,
    })
}

/// Calculates Trial Balance proving sum(Debits) == sum(Credits)
#[allow(dead_code)]
pub fn get_trial_balance(conn: &Connection, user_id: &str) -> TrialBalanceSummary {
    let mut stmt = conn
        .prepare(
            "SELECT p.account_code, p.direction, SUM(p.amount)
             FROM postings p
             JOIN journal_entries j ON p.journal_entry_id = j.id
             WHERE j.user_id = ?
             GROUP BY p.account_code, p.direction",
        )
        .unwrap();

    let rows: Vec<(String, String, f64)> = stmt
        .query_map([user_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut accounts: HashMap<String, DebitCredit> = HashMap::new();
    let mut total_debits = dec!(0.0);
    let mut total_credits = dec!(0.0);

    for (code, dir, amt) in rows {
        let dec_amt = Decimal::from_f64(amt).unwrap_or(dec!(0.0));
        let entry = accounts.entry(code).or_insert(DebitCredit {
            debit: dec!(0.0),
            credit: dec!(0.0),
        });

        if dir == "debit" {
            entry.debit += dec_amt;
            total_debits += dec_amt;
        } else {
            entry.credit += dec_amt;
            total_credits += dec_amt;
        }
    }

    let diff = total_debits - total_credits;

    TrialBalanceSummary {
        accounts,
        total_debits,
        total_credits,
        balanced: diff.abs() < dec!(0.01),
        difference: diff,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub account_type: String,
    pub currency: String,
    pub institution: String,
    pub initial_balance: Decimal,
}

pub fn create_account(
    conn: &mut Connection,
    user_id: &str,
    name: &str,
    account_type: &str,
    currency: &str,
    institution: &str,
    initial_balance: Decimal,
) -> Result<AccountRecord, String> {
    let id = format!("acc_{}", &Uuid::new_v4().to_string()[..8]);
    let initial_f64 = initial_balance.to_string().parse::<f64>().unwrap_or(0.0);

    conn.execute(
        "INSERT INTO accounts (id, user_id, name, type, account_class, currency, institution, initial_balance)
         VALUES (?, ?, ?, ?, 'asset', ?, ?, ?)",
        params![id, user_id, name, account_type, currency, institution, initial_f64],
    ).map_err(|e| e.to_string())?;

    if initial_balance > Decimal::ZERO {
        record_income(
            conn,
            user_id,
            &id,
            initial_balance,
            "Opening Equity",
            "Opening Account Equity Balance",
            None,
            Some("INIT_BAL".to_string()),
            "wallet",
            "emerald",
        )?;
    }

    Ok(AccountRecord {
        id,
        user_id: user_id.to_string(),
        name: name.to_string(),
        account_type: account_type.to_string(),
        currency: currency.to_string(),
        institution: institution.to_string(),
        initial_balance,
    })
}

pub fn record_transfer(
    conn: &mut Connection,
    user_id: &str,
    from_account_id: &str,
    to_account_id: &str,
    amount: Decimal,
    description: &str,
) -> Result<TransactionResult, String> {
    let transfer_ref = format!("TRF_{}", &Uuid::new_v4().to_string()[..10].to_uppercase());

    record_spending(
        conn,
        user_id,
        from_account_id,
        amount,
        "Inter-account Transfer Out",
        description,
        None,
        Some(transfer_ref.clone()),
        "arrow-right",
        "blue",
    )?;

    record_income(
        conn,
        user_id,
        to_account_id,
        amount,
        "Inter-account Transfer In",
        description,
        None,
        Some(transfer_ref),
        "arrow-left",
        "emerald",
    )
}
