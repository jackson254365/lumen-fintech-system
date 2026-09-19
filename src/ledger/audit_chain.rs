// ============================================================================
// Cryptographic SHA-256 Audit Hash Chain Auditor
// Verifies mathematical block chain integrity across all journal entries from genesis
// ============================================================================
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const GENESIS_HASH: &str =
    "GENESIS_LUMEN_FINTECH_CRYPTOGRAPHIC_LEDGER_CHAIN_2026_0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditVerificationResult {
    pub valid: bool,
    pub entries_verified: usize,
    pub broken_at_sequence: Option<i64>,
    pub broken_entry_id: Option<String>,
    pub tip_hash: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerTip {
    pub sequence: i64,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostingPayload {
    pub account_id: Option<String>,
    pub account_code: String,
    pub direction: String,
    pub amount: f64,
}

pub fn compute_entry_hash(
    prev_hash: &str,
    sequence: i64,
    entry_id: &str,
    date: &str,
    description: &str,
    postings: &[PostingPayload],
) -> String {
    let mut hasher = Sha256::new();
    let sorted_postings = serde_json::to_string(postings).unwrap_or_default();

    let raw = format!(
        "{}|{}|{}|{}|{}|{}",
        prev_hash, sequence, entry_id, date, description, sorted_postings
    );

    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn get_latest_tip(conn: &Connection, user_id: &str) -> LedgerTip {
    let mut stmt = conn
        .prepare(
            "SELECT sequence_num, entry_hash
             FROM journal_entries
             WHERE user_id = ?
             ORDER BY sequence_num DESC
             LIMIT 1",
        )
        .unwrap();

    let mut rows = stmt.query([user_id]).unwrap();

    if let Ok(Some(row)) = rows.next() {
        let seq: i64 = row.get(0).unwrap();
        let hash: String = row.get(1).unwrap();
        LedgerTip {
            sequence: seq,
            hash,
        }
    } else {
        LedgerTip {
            sequence: 0,
            hash: GENESIS_HASH.to_string(),
        }
    }
}

pub fn verify_audit_chain(conn: &Connection, user_id: &str) -> AuditVerificationResult {
    let mut stmt = conn
        .prepare(
            "SELECT id, sequence_num, date, description, prev_hash, entry_hash
             FROM journal_entries
             WHERE user_id = ?
             ORDER BY sequence_num ASC",
        )
        .unwrap();

    let entries: Vec<(String, i64, String, String, String, String)> = stmt
        .query_map([user_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    if entries.is_empty() {
        return AuditVerificationResult {
            valid: true,
            entries_verified: 0,
            broken_at_sequence: None,
            broken_entry_id: None,
            tip_hash: GENESIS_HASH.to_string(),
            message: "Ledger is empty. Cryptographic genesis chain ready.".to_string(),
        };
    }

    let mut expected_prev = GENESIS_HASH.to_string();
    let mut count = 0;

    for (id, seq, date, desc, prev_hash, entry_hash) in &entries {
        count += 1;

        if prev_hash != &expected_prev {
            return AuditVerificationResult {
                valid: false,
                entries_verified: count - 1,
                broken_at_sequence: Some(*seq),
                broken_entry_id: Some(id.clone()),
                tip_hash: entry_hash.clone(),
                message: format!(
                    "Cryptographic link broken at sequence #{}: prev_hash mismatch",
                    seq
                ),
            };
        }

        // Retrieve postings for this entry
        let mut post_stmt = conn
            .prepare(
                "SELECT account_id, account_code, direction, amount
                 FROM postings
                 WHERE journal_entry_id = ?
                 ORDER BY direction ASC, account_code ASC",
            )
            .unwrap();

        let postings: Vec<PostingPayload> = post_stmt
            .query_map([id], |row| {
                Ok(PostingPayload {
                    account_id: row.get(0)?,
                    account_code: row.get(1)?,
                    direction: row.get(2)?,
                    amount: row.get(3)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let computed = compute_entry_hash(prev_hash, *seq, id, date, desc, &postings);

        if &computed != entry_hash {
            return AuditVerificationResult {
                valid: false,
                entries_verified: count - 1,
                broken_at_sequence: Some(*seq),
                broken_entry_id: Some(id.clone()),
                tip_hash: entry_hash.clone(),
                message: format!(
                    "Cryptographic SHA-256 signature mismatch at sequence #{}: entry was altered or postings modified",
                    seq
                ),
            };
        }

        expected_prev = entry_hash.clone();
    }

    let tip_hash = entries.last().map(|e| e.5.clone()).unwrap_or_default();

    AuditVerificationResult {
        valid: true,
        entries_verified: count,
        broken_at_sequence: None,
        broken_entry_id: None,
        tip_hash,
        message: format!(
            "All {} cryptographic blocks mathematically verified. Zero tampering detected.",
            count
        ),
    }
}
