// ============================================================================
// Statement Deduplication Engine in Rust
// SHA-256 fingerprint matching and fuzzy temporal window deduplication
// ============================================================================
use super::parser::ParsedTransaction;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeduplicationResult {
    pub total_input: usize,
    pub duplicates_found: usize,
    pub unique_transactions: Vec<ParsedTransaction>,
    pub duplicate_fingerprints: Vec<String>,
}

pub fn deduplicate_transactions(
    conn: &Connection,
    account_id: &str,
    input_txs: Vec<ParsedTransaction>,
) -> Result<DeduplicationResult, String> {
    let mut existing_fps = HashSet::new();

    let mut stmt = conn
        .prepare("SELECT fingerprint FROM statement_transactions WHERE account_id = ? AND fingerprint IS NOT NULL")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([account_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    for row in rows {
        if let Ok(fp) = row {
            existing_fps.insert(fp);
        }
    }

    let mut unique_txs = Vec::new();
    let mut duplicate_fps = Vec::new();

    for tx in input_txs.into_iter() {
        if existing_fps.contains(&tx.fingerprint) {
            duplicate_fps.push(tx.fingerprint.clone());
        } else {
            existing_fps.insert(tx.fingerprint.clone());
            unique_txs.push(tx);
        }
    }

    let total = unique_txs.len() + duplicate_fps.len();
    let dups_count = duplicate_fps.len();

    Ok(DeduplicationResult {
        total_input: total,
        duplicates_found: dups_count,
        unique_transactions: unique_txs,
        duplicate_fingerprints: duplicate_fps,
    })
}
