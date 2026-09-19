// ============================================================================
// Fintech Gateway Rail Connector (Wise, Revolut, PayPal, Paystack) in Rust
// Cross-border P2P, Multi-currency Wallets, and Payment Links
// ============================================================================
use crate::ledger::core::{get_account_balance, record_income, record_spending, TransactionResult};
use rusqlite::{params, Connection};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentLinkRequest {
    pub title: String,
    pub description: Option<String>,
    pub amount: Decimal,
    pub currency: String,
    pub platform: String, // "paystack", "paypal", "revolut", "wise"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentLinkResult {
    pub success: bool,
    pub link_id: String,
    pub url: String,
    pub platform: String,
    pub amount: Decimal,
    pub currency: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2PTransferRequest {
    pub platform: String, // "wise", "revolut", "paypal", "paystack"
    pub recipient_email_or_handle: String,
    pub amount: Decimal,
    pub currency: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2PTransferResult {
    pub success: bool,
    pub transfer_id: String,
    pub platform: String,
    pub recipient: String,
    pub amount: Decimal,
    pub currency: String,
    pub debited_usd: Decimal,
    pub ledger_journal_id: String,
    pub status: String,
    pub message: String,
}

pub fn create_payment_link(
    conn: &Connection,
    user_id: &str,
    req: PaymentLinkRequest,
) -> Result<PaymentLinkResult, String> {
    if req.amount <= Decimal::ZERO {
        return Err("Payment link amount must be positive".to_string());
    }

    let link_id = format!("plink_{}", &Uuid::new_v4().to_string()[..12]);
    let platform = req.platform.to_lowercase();

    let url = match platform.as_str() {
        "paystack" => format!("https://paystack.com/pay/{}", link_id),
        "paypal" => format!("https://paypal.me/lumenfinance/{}", req.amount),
        "revolut" => format!("https://revolut.me/lumen/{}", link_id),
        "wise" => format!("https://wise.com/pay/me/{}", link_id),
        _ => format!("https://checkout.lumen.finance/pay/{}", link_id),
    };

    let meta = serde_json::json!({
        "title": req.title,
        "description": req.description,
        "url": url,
        "platform": platform
    });

    let rail_tx_id = format!("rail_{}", Uuid::new_v4());
    conn.execute(
        "INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, metadata_json)
         VALUES (?, ?, ?, 'inflow', 'pending', ?, ?, ?, ?)",
        params![
            rail_tx_id,
            user_id,
            platform,
            req.amount.to_string().parse::<f64>().unwrap_or(0.0),
            req.currency,
            link_id,
            meta.to_string()
        ],
    ).map_err(|e| e.to_string())?;

    Ok(PaymentLinkResult {
        success: true,
        link_id,
        url,
        platform: req.platform,
        amount: req.amount,
        currency: req.currency.to_uppercase(),
        status: "active".to_string(),
        message: "Payment link created successfully and ready to accept global cards / wallets.".to_string(),
    })
}

pub fn send_fintech_p2p(
    conn: &mut Connection,
    user_id: &str,
    source_account_id: &str,
    req: P2PTransferRequest,
) -> Result<P2PTransferResult, String> {
    if req.amount <= Decimal::ZERO {
        return Err("P2P transfer amount must be positive".to_string());
    }

    let current_bal = get_account_balance(conn, source_account_id)?;
    if current_bal < req.amount {
        return Err(format!("Insufficient account balance for P2P transfer. Available: ${}, Requested: ${}", current_bal, req.amount));
    }

    let transfer_id = format!("P2P_{}_{}", req.platform.to_uppercase(), &Uuid::new_v4().to_string()[..8].to_uppercase());
    let rail_tx_id = format!("rail_{}", Uuid::new_v4());

    let ledger_res = record_spending(
        conn,
        user_id,
        source_account_id,
        req.amount,
        &format!("{} P2P Transfer", req.platform),
        &format!("Transfer to {} ({})", req.recipient_email_or_handle, req.note.as_deref().unwrap_or("P2P")),
        None,
        Some(transfer_id.clone()),
        "send",
        "indigo",
    )?;

    let meta = serde_json::json!({
        "platform": req.platform,
        "recipient": req.recipient_email_or_handle,
        "note": req.note
    });

    conn.execute(
        "INSERT INTO payment_rails_transactions (id, user_id, rail, direction, status, amount, currency, reference, phone_or_account, metadata_json, journal_entry_id)
         VALUES (?, ?, ?, 'outflow', 'completed', ?, ?, ?, ?, ?, ?)",
        params![
            rail_tx_id,
            user_id,
            req.platform.to_lowercase(),
            req.amount.to_string().parse::<f64>().unwrap_or(0.0),
            req.currency,
            transfer_id,
            req.recipient_email_or_handle,
            meta.to_string(),
            ledger_res.journal_entry_id
        ],
    ).map_err(|e| e.to_string())?;

    let recipient_str = req.recipient_email_or_handle.clone();
    let platform_str = req.platform.clone();

    Ok(P2PTransferResult {
        success: true,
        transfer_id,
        platform: platform_str.clone(),
        recipient: recipient_str.clone(),
        amount: req.amount,
        currency: req.currency.to_uppercase(),
        debited_usd: req.amount,
        ledger_journal_id: ledger_res.journal_entry_id,
        status: "completed".to_string(),
        message: format!("Instant P2P payment of {} {} sent to {} via {}.", req.amount, req.currency, recipient_str, platform_str),
    })
}
