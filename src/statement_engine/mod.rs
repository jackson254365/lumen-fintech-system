pub mod categorizer;
pub mod deduplicator;
pub mod parser;

use categorizer::categorize_transaction;
use deduplicator::deduplicate_transactions;
use parser::parse_statement;
use rusqlite::{params, Connection};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatementImportResult {
    pub success: bool,
    pub account_id: String,
    pub total_parsed: usize,
    pub imported_count: usize,
    pub duplicates_skipped: usize,
    pub ledger_entries_created: usize,
    pub message: String,
}

pub fn import_bank_statement(
    conn: &mut Connection,
    user_id: &str,
    account_id: &str,
    raw_content: &str,
    filename: Option<&str>,
) -> Result<StatementImportResult, String> {
    let parse_res = parse_statement(raw_content, filename, "USD");
    let dedup_res = deduplicate_transactions(conn, account_id, parse_res.transactions)?;

    let mut imported_count = 0;
    let mut ledger_entries = 0;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for tx_item in dedup_res.unique_transactions {
        let (cat, icon, color) = categorize_transaction(&tx_item.description);
        let id = format!("stmt_{}", Uuid::new_v4());

        // Insert into statement_transactions
        tx.execute(
            "INSERT INTO statement_transactions (id, account_id, date, description, amount, currency, category, status, fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?)",
            params![
                id,
                account_id,
                tx_item.date,
                tx_item.description,
                tx_item.amount.to_string().parse::<f64>().unwrap_or(0.0),
                tx_item.currency,
                cat,
                tx_item.fingerprint
            ],
        )
        .map_err(|e| e.to_string())?;

        imported_count += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(StatementImportResult {
        success: true,
        account_id: account_id.to_string(),
        total_parsed: parse_res.total_parsed,
        imported_count,
        duplicates_skipped: dedup_res.duplicates_found,
        ledger_entries_created: ledger_entries,
        message: format!(
            "Successfully imported {} new transactions ({} duplicates skipped).",
            imported_count, dedup_res.duplicates_found
        ),
    })
}
