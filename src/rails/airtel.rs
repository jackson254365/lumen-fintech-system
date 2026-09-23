// ============================================================================
// Airtel Money Payment Rail Connector in Rust
// Airtel Money API: Collection, Disbursement, and Ledger Integration
// ============================================================================
use crate::ledger::core::{get_account_balance, record_spending};
use rusqlite::{params, Connection};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const KES_TO_USD_RATE: Decimal = dec!(0.00769230769); // 1 / 130.0
pub const UGX_TO_USD_RATE: Decimal = dec!(0.00027027);    // 1 / 3700.0

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirtelCollectionResult {
    pub success: bool,
    pub transaction_id: String,
    pub reference_id: String,
    pub phone_number: String,
    pub amount: i64,
    pub currency: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirtelDisbursementResult {
    pub success: bool,
    pub status: String,
    pub transaction_id: String,
    pub recipient_phone: String,
    pub amount: i64,
    pub currency: String,
    pub debited_usd: Decimal,
    pub new_balance_usd: Decimal,
    pub message: String,
}

pub fn ensure_airtel_account(conn: &Connection, user_id: &str) -> String {
    let mut stmt = conn
        .prepare("SELECT id FROM accounts WHERE user_id = ? AND (name LIKE '%Airtel%' OR id = 'airtel_wallet')")
        .unwrap();

    let account_id: Option<String> = stmt.query_row([user_id], |row| row.get(0)).ok();

    if let Some(id) = account_id {
        id
    } else {
        let new_id = format!("acc_airtel_{}", &Uuid::new_v4().to_string()[..8]);
        conn.execute(
            "INSERT INTO accounts (id, user_id, name, type, account_class, currency, institution, initial_balance)
             VALUES (?, ?, 'Airtel Money Wallet', 'cash', 'asset', 'KES', 'Airtel Money', 0)",
            params![new_id, user_id],
        )
        .unwrap();
        new_id
    }
}

pub fn initiate_airtel_collection(
    conn: &Connection,
    user_id: &str,
    phone_number: &str,
    amount: i64,
    currency: &str,
) -> Result<AirtelCollectionResult, String> {
    if amount <= 0 {
        return Err("Airtel Money amount must be positive".to_string());
    }

    let airtel_account_id = ensure_airtel_account(conn, user_id);
    let reference_id = format!("AIRTEL_REF_{}", &Uuid::new_v4().to_string()[..10].to_uppercase());
    let rail_tx_id = format!("rail_{}", Uuid::new_v4());

    let rate = if currency.to_uppercase() == "UGX" {
        UGX_TO_USD_RATE
    } else {
        KES_TO_USD_RATE
    };
    let converted_usd = (Decimal::from(amount) * rate).round_dp(2);

    let meta = serde_json::json!({
        "rail": "airtel",
        "reference": reference_id,
        "accountId": airtel_account_id,
        "convertedUsd": converted_usd
    });

    conn.execute(
        "INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json)
         VALUES (?, ?, 'airtel', 'inflow', 'pending', ?, ?, ?, ?, ?)",
        params![rail_tx_id, user_id, amount as f64, currency, reference_id, phone_number, meta.to_string()],
    ).map_err(|e| e.to_string())?;

    Ok(AirtelCollectionResult {
        success: true,
        transaction_id: rail_tx_id,
        reference_id,
        phone_number: phone_number.to_string(),
        amount,
        currency: currency.to_uppercase(),
        status: "pending".to_string(),
        message: format!("Airtel Money collection prompt sent to {}.", phone_number),
    })
}

pub fn send_airtel_disbursement(
    conn: &mut Connection,
    user_id: &str,
    recipient_phone: &str,
    amount: i64,
    currency: &str,
) -> Result<AirtelDisbursementResult, String> {
    if amount <= 0 {
        return Err("Disbursement amount must be positive".to_string());
    }

    let airtel_account_id = ensure_airtel_account(conn, user_id);
    let rate = if currency.to_uppercase() == "UGX" {
        UGX_TO_USD_RATE
    } else {
        KES_TO_USD_RATE
    };
    let usd_amount = (Decimal::from(amount) * rate).round_dp(2);

    let current_bal = get_account_balance(conn, &airtel_account_id)?;
    if current_bal < usd_amount {
        return Err(format!("Insufficient funds in Airtel Money account. Available: ${}, Requested: ${}", current_bal, usd_amount));
    }

    let tx_id = format!("AIRTEL_OUT_{}", &Uuid::new_v4().to_string()[..10].to_uppercase());
    let rail_tx_id = format!("rail_{}", Uuid::new_v4());

    let ledger_res = record_spending(
        conn,
        user_id,
        &airtel_account_id,
        usd_amount,
        "Airtel Money Disbursement",
        &format!("Airtel Money payout to {}", recipient_phone),
        None,
        Some(tx_id.clone()),
        "arrow-up-right",
        "red",
    )?;

    let meta = serde_json::json!({
        "rail": "airtel",
        "convertedUsd": usd_amount
    });

    conn.execute(
        "INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json, journal_entry_id)
         VALUES (?, ?, 'airtel', 'outflow', 'completed', ?, ?, ?, ?, ?, ?)",
        params![rail_tx_id, user_id, amount as f64, currency, tx_id, recipient_phone, meta.to_string(), ledger_res.journal_entry_id],
    ).map_err(|e| e.to_string())?;

    let new_bal = get_account_balance(conn, &airtel_account_id)?;

    Ok(AirtelDisbursementResult {
        success: true,
        status: "completed".to_string(),
        transaction_id: tx_id,
        recipient_phone: recipient_phone.to_string(),
        amount,
        currency: currency.to_uppercase(),
        debited_usd: usd_amount,
        new_balance_usd: new_bal,
        message: format!("{} {} successfully disbursed to {} via Airtel Money.", currency, amount, recipient_phone),
    })
}
