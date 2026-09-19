pub mod airtel;
pub mod bank_transfer;
pub mod crypto;
pub mod fintech_gateway;
pub mod mpesa;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailTransaction {
    pub id: String,
    pub user_id: String,
    pub rail: String,
    pub direction: String,
    pub status: String,
    pub amount: f64,
    pub currency: String,
    pub reference: Option<String>,
    pub phone_or_account: Option<String>,
    pub metadata_json: Option<String>,
    pub journal_entry_id: Option<String>,
    pub created_at: String,
}

pub fn get_user_rail_transactions(
    conn: &Connection,
    user_id: &str,
    limit: usize,
) -> Result<Vec<RailTransaction>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json, journal_entry_id, created_at
             FROM payment_rails_transactions
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ?",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![user_id, limit as i64], |row| {
            Ok(RailTransaction {
                id: row.get(0)?,
                user_id: row.get(1)?,
                rail: row.get(2)?,
                direction: row.get(3)?,
                status: row.get(4)?,
                amount: row.get(5)?,
                currency: row.get(6)?,
                reference: row.get(7)?,
                phone_or_account: row.get(8)?,
                metadata_json: row.get(9)?,
                journal_entry_id: row.get(10)?,
                created_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
