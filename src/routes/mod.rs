// ============================================================================
// Axum REST API Routes & Handlers in Rust
// Production-grade endpoints for Ledger, Rails, Statements, Research & Web UI
// ============================================================================
use crate::db::DbPool;
use crate::ledger::audit_chain::verify_audit_chain;
use crate::ledger::chart_of_accounts::generate_trial_balance;
use crate::ledger::core::{
    create_account, get_account_balance, record_income, record_spending, record_transfer,
    TransactionResult,
};
use crate::rails::airtel::{initiate_airtel_collection, send_airtel_disbursement};
use crate::rails::bank_transfer::{process_outward_wire, WireTransferRequest};
use crate::rails::crypto::{
    deposit_onchain, ensure_crypto_wallet, get_crypto_prices, trade_crypto_buy_sell,
    withdraw_onchain,
};
use crate::rails::fintech_gateway::{create_payment_link, send_fintech_p2p, P2PTransferRequest, PaymentLinkRequest};
use crate::rails::mpesa::{initiate_stk_push, send_b2c_payout};
use crate::rails::get_user_rail_transactions;
use crate::research_engine::{
    calculate_financial_health_score, detect_subscriptions, detect_transaction_anomalies,
    generate_cash_flow_forecast, run_monte_carlo_simulation, MonteCarloInput,
};
use crate::statement_engine::import_bank_statement;

use axum::{
    extract::{Multipart, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use rusqlite::params;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

pub struct AppState {
    pub pool: DbPool,
}

pub fn create_router(pool: DbPool) -> Router {
    let state = Arc::new(AppState { pool });

    Router::new()
        // System endpoints
        .route("/api/system/health", get(health_check))
        .route("/api/system/export", get(export_system_data))
        // Accounts endpoints
        .route("/api/accounts", get(get_accounts).post(add_account))
        // Ledger & Transactions endpoints
        .route("/api/transactions", get(get_transactions).post(post_transaction))
        .route("/api/transactions/transfer", post(post_transfer))
        .route("/api/budgets", get(get_budgets))
        .route("/api/ledger/trial-balance", get(get_trial_balance))
        .route("/api/ledger/balance-sheet", get(get_balance_sheet))
        .route("/api/ledger/income-statement", get(get_income_statement))
        .route("/api/ledger/verify-audit", get(verify_audit))
        // Payment Rails endpoints
        .route("/api/rails/mpesa/stk-push", post(mpesa_stk_push))
        .route("/api/rails/mpesa/b2c", post(mpesa_b2c))
        .route("/api/rails/airtel/collection", post(airtel_collection))
        .route("/api/rails/airtel/disbursement", post(airtel_disbursement))
        .route("/api/rails/bank/wire", post(bank_wire))
        .route("/api/rails/crypto/prices", get(crypto_prices))
        .route("/api/rails/crypto/wallet", get(crypto_wallet))
        .route("/api/rails/crypto/receive", post(crypto_receive))
        .route("/api/rails/crypto/send", post(crypto_send))
        .route("/api/rails/crypto/buy", post(crypto_buy))
        .route("/api/rails/crypto/sell", post(crypto_sell))
        .route("/api/rails/crypto/swap", post(crypto_swap))
        .route("/api/rails/fintech/paylink", post(fintech_paylink))
        .route("/api/rails/fintech/send-p2p", post(fintech_p2p))
        .route("/api/rails/transactions", get(rail_transactions))
        // Statement Engine endpoints
        .route("/api/statements/parse", post(parse_statement_handler))
        .route("/api/statements/import", post(import_statement_handler))
        // Computational Research Engine endpoints
        .route("/api/research/forecast", get(research_forecast))
        .route("/api/research/monte-carlo", post(research_monte_carlo))
        .route("/api/research/health-score", get(research_health_score))
        .route("/api/research/subscriptions", get(research_subscriptions))
        .route("/api/research/anomalies", get(research_anomalies))
        .with_state(state)
}

// ----------------------------------------------------------------------------
// 1. System Handlers
// ----------------------------------------------------------------------------
async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM accounts").unwrap();
    let count: i64 = stmt.query_row([], |r| r.get(0)).unwrap_or(0);

    Json(json!({
        "status": "healthy",
        "version": "1.0.0",
        "environment": "production",
        "engine": "Rust (Axum + Tokio + Rusqlite)",
        "database": "SQLite (WAL Mode)",
        "total_accounts": count,
        "precision": "128-bit rust_decimal"
    }))
}

async fn export_system_data(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();

    let mut acc_stmt = conn.prepare("SELECT id, user_id, name, type, account_class, currency, initial_balance FROM accounts").unwrap();
    let accounts: Vec<serde_json::Value> = acc_stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "user_id": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "type": r.get::<_, String>(3)?,
                "account_class": r.get::<_, String>(4)?,
                "currency": r.get::<_, String>(5)?,
                "initial_balance": r.get::<_, f64>(6)?
            }))
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect();

    let mut audit_stmt = conn.prepare("SELECT sequence_num, block_hash, previous_block_hash, timestamp FROM audit_chain ORDER BY sequence_num ASC").unwrap();
    let audit_chain: Vec<serde_json::Value> = audit_stmt
        .query_map([], |r| {
            Ok(json!({
                "sequence_num": r.get::<_, i64>(0)?,
                "block_hash": r.get::<_, String>(1)?,
                "previous_block_hash": r.get::<_, String>(2)?,
                "timestamp": r.get::<_, String>(3)?
            }))
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect();

    Json(json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "accounts": accounts,
        "audit_chain": audit_chain
    }))
}

// ----------------------------------------------------------------------------
// 2. Accounts Handlers
// ----------------------------------------------------------------------------
async fn get_accounts(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let mut stmt = conn.prepare("SELECT id, user_id, name, type, account_class, currency, institution, initial_balance, metadata_json FROM accounts").unwrap();

    let accounts: Vec<serde_json::Value> = stmt
        .query_map([], |r| {
            let id: String = r.get(0)?;
            let bal = get_account_balance(&conn, &id).unwrap_or(Decimal::ZERO);
            let meta_str: Option<String> = r.get(8)?;
            let meta_json: Option<serde_json::Value> = meta_str.and_then(|s| serde_json::from_str(&s).ok());

            Ok(json!({
                "id": id,
                "userId": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "type": r.get::<_, String>(3)?,
                "accountClass": r.get::<_, String>(4)?,
                "currency": r.get::<_, String>(5)?,
                "institution": r.get::<_, String>(6)?,
                "balance": bal,
                "initialBalance": r.get::<_, f64>(7)?,
                "metadata": meta_json
            }))
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect();

    Json(json!({ "accounts": accounts }))
}

#[derive(Deserialize)]
struct CreateAccountPayload {
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub currency: Option<String>,
    pub institution: Option<String>,
    #[serde(rename = "initialBalance")]
    pub initial_balance: Option<Decimal>,
}

async fn add_account(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateAccountPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    let curr = payload.currency.as_deref().unwrap_or("USD");
    let inst = payload.institution.as_deref().unwrap_or("Primary Institution");
    let init_bal = payload.initial_balance.unwrap_or(Decimal::ZERO);

    match create_account(&mut conn, "default_user", &payload.name, &payload.account_type, curr, inst, init_bal) {
        Ok(acc) => (StatusCode::CREATED, Json(json!({ "success": true, "account": acc }))).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

// ----------------------------------------------------------------------------
// 3. Transactions & Ledger Handlers
// ----------------------------------------------------------------------------
#[derive(Deserialize)]
struct TransactionQuery {
    pub limit: Option<usize>,
    pub search: Option<String>,
    pub category: Option<String>,
}

async fn get_transactions(
    State(state): State<Arc<AppState>>,
    Query(q): Query<TransactionQuery>,
) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let limit = q.limit.unwrap_or(100);

    let mut stmt = conn
        .prepare(
            "SELECT jl.id, je.date, jl.description, jl.debit_amount, jl.credit_amount, a.name, a.currency, jl.category, jl.icon, jl.color
             FROM journal_lines jl
             JOIN journal_entries je ON jl.journal_entry_id = je.id
             JOIN accounts a ON jl.account_id = a.id
             ORDER BY je.date DESC, je.created_at DESC
             LIMIT ?",
        )
        .unwrap();

    let txs: Vec<serde_json::Value> = stmt
        .query_map(params![limit as i64], |r| {
            let debit: f64 = r.get(3)?;
            let credit: f64 = r.get(4)?;
            let is_debit = debit > 0.0;
            let amount = if is_debit { debit } else { credit };

            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "date": r.get::<_, String>(1)?,
                "description": r.get::<_, String>(2)?,
                "amount": amount,
                "type": if is_debit { "spending" } else { "income" },
                "accountName": r.get::<_, String>(5)?,
                "currency": r.get::<_, String>(6)?,
                "category": r.get::<_, String>(7)?,
                "icon": r.get::<_, String>(8)?,
                "color": r.get::<_, String>(9)?
            }))
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect();

    Json(json!({ "transactions": txs }))
}

#[derive(Deserialize)]
struct PostTxPayload {
    #[serde(rename = "accountId")]
    pub account_id: String,
    pub amount: Decimal,
    #[serde(rename = "type")]
    pub tx_type: String, // "income" or "spending"
    pub merchant: String,
    pub category: Option<String>,
    pub reference: Option<String>,
}

async fn post_transaction(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<PostTxPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();

    // Idempotency check if header present
    if let Some(idem_key) = headers.get("Idempotency-Key").and_then(|h| h.to_str().ok()) {
        let mut stmt = conn
            .prepare("SELECT id FROM journal_entries WHERE reference = ?")
            .unwrap();
        if stmt.exists([idem_key]).unwrap_or(false) {
            return (StatusCode::OK, Json(json!({ "success": true, "message": "Idempotent request ignored (duplicate transaction)" }))).into_response();
        }
    }

    let cat = payload.category.as_deref().unwrap_or("General Expenses");
    let ref_str = payload.reference;

    let res = if payload.tx_type.to_lowercase() == "income" {
        record_income(&mut conn, "default_user", &payload.account_id, payload.amount, &payload.merchant, &format!("Deposit from {}", payload.merchant), None, ref_str, "arrow-down-left", "emerald")
    } else {
        record_spending(&mut conn, "default_user", &payload.account_id, payload.amount, &payload.merchant, &format!("Payment to {}", payload.merchant), None, ref_str, "shopping-bag", "orange")
    };

    match res {
        Ok(t) => (StatusCode::CREATED, Json(json!({ "success": true, "result": t }))).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct TransferPayload {
    #[serde(rename = "fromAccountId")]
    pub from_account_id: String,
    #[serde(rename = "toAccountId")]
    pub to_account_id: String,
    pub amount: Decimal,
    pub description: Option<String>,
}

async fn post_transfer(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<TransferPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    let desc = payload.description.as_deref().unwrap_or("Inter-account Transfer");

    match record_transfer(&mut conn, "default_user", &payload.from_account_id, &payload.to_account_id, payload.amount, desc) {
        Ok(t) => (StatusCode::CREATED, Json(json!({ "success": true, "result": t }))).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

async fn get_budgets(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let mut stmt = conn
        .prepare("SELECT category, limit_amount, current_spend FROM envelope_budgets WHERE user_id = 'default_user'")
        .unwrap();

    let budgets: Vec<serde_json::Value> = stmt
        .query_map([], |r| {
            Ok(json!({
                "category": r.get::<_, String>(0)?,
                "limit": r.get::<_, f64>(1)?,
                "spent": r.get::<_, f64>(2)?
            }))
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect();

    Json(json!({ "budgets": budgets }))
}

async fn get_trial_balance(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    match generate_trial_balance(&conn, "default_user") {
        Ok(tb) => Json(json!({ "success": true, "trialBalance": tb })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
    }
}

async fn get_balance_sheet(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let tb = generate_trial_balance(&conn, "default_user").unwrap();

    let total_assets = tb.lines.iter().filter(|l| l.account_class == "asset").map(|l| l.ending_balance).sum::<Decimal>();
    let total_liabilities = tb.lines.iter().filter(|l| l.account_class == "liability").map(|l| l.ending_balance).sum::<Decimal>();
    let total_equity = tb.lines.iter().filter(|l| l.account_class == "equity").map(|l| l.ending_balance).sum::<Decimal>();

    Json(json!({
        "success": true,
        "asOfDate": chrono::Utc::now().to_rfc3339(),
        "totalAssets": total_assets,
        "totalLiabilities": total_liabilities,
        "totalEquity": total_equity,
        "inEquilibrium": total_assets == (total_liabilities + total_equity)
    }))
}

async fn get_income_statement(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let tb = generate_trial_balance(&conn, "default_user").unwrap();

    let total_revenue = tb.lines.iter().filter(|l| l.account_class == "revenue").map(|l| l.ending_balance).sum::<Decimal>();
    let total_expenses = tb.lines.iter().filter(|l| l.account_class == "expense").map(|l| l.ending_balance).sum::<Decimal>();
    let net_income = total_revenue - total_expenses;

    Json(json!({
        "success": true,
        "totalRevenue": total_revenue,
        "totalExpenses": total_expenses,
        "netIncome": net_income
    }))
}

async fn verify_audit(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let res = verify_audit_chain(&conn, "default_user");
    Json(json!({ "success": true, "audit": res }))
}

// ----------------------------------------------------------------------------
// 4. Payment Rails Handlers
// ----------------------------------------------------------------------------
#[derive(Deserialize)]
struct MpesaStkPayload {
    #[serde(rename = "phoneNumber")]
    pub phone_number: String,
    #[serde(rename = "amountKes")]
    pub amount_kes: i64,
    pub description: Option<String>,
}

async fn mpesa_stk_push(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MpesaStkPayload>,
) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    match initiate_stk_push(&conn, "default_user", &payload.phone_number, payload.amount_kes, payload.description.as_deref()) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct MpesaB2cPayload {
    #[serde(rename = "recipientPhone")]
    pub recipient_phone: String,
    #[serde(rename = "amountKes")]
    pub amount_kes: i64,
    pub description: Option<String>,
}

async fn mpesa_b2c(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MpesaB2cPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    match send_b2c_payout(&mut conn, "default_user", &payload.recipient_phone, payload.amount_kes, payload.description.as_deref()) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct AirtelCollectionPayload {
    #[serde(rename = "phoneNumber")]
    pub phone_number: String,
    pub amount: i64,
    pub currency: Option<String>,
}

async fn airtel_collection(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AirtelCollectionPayload>,
) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let curr = payload.currency.as_deref().unwrap_or("KES");
    match initiate_airtel_collection(&conn, "default_user", &payload.phone_number, payload.amount, curr) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct AirtelDisbursementPayload {
    #[serde(rename = "recipientPhone")]
    pub recipient_phone: String,
    pub amount: i64,
    pub currency: Option<String>,
}

async fn airtel_disbursement(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AirtelDisbursementPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    let curr = payload.currency.as_deref().unwrap_or("KES");
    match send_airtel_disbursement(&mut conn, "default_user", &payload.recipient_phone, payload.amount, curr) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct BankWirePayload {
    pub iban: String,
    #[serde(rename = "recipientName")]
    pub recipient_name: String,
    #[serde(rename = "amountUsd")]
    pub amount_usd: Decimal,
    pub bic: Option<String>,
    #[serde(rename = "type")]
    pub wire_type: Option<String>,
}

async fn bank_wire(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<BankWirePayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    let req = WireTransferRequest {
        beneficiary_name: payload.recipient_name,
        iban_or_account: payload.iban,
        bic_swift: payload.bic.unwrap_or_else(|| "CHASUS33XXX".into()),
        bank_name: "JPMorgan Chase Bank".to_string(),
        amount: payload.amount_usd,
        currency: "USD".to_string(),
        wire_type: payload.wire_type.unwrap_or_else(|| "SWIFT".into()),
        reference: None,
    };

    match process_outward_wire(&mut conn, "default_user", req) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

async fn crypto_prices() -> impl IntoResponse {
    Json(json!({ "success": true, "prices": get_crypto_prices() }))
}

#[derive(Deserialize)]
struct CryptoWalletQuery {
    pub network: Option<String>,
    pub asset: Option<String>,
}

async fn crypto_wallet(
    State(state): State<Arc<AppState>>,
    Query(q): Query<CryptoWalletQuery>,
) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let asset = q.asset.as_deref().or(q.network.as_deref()).unwrap_or("cUSD");
    let (acc_id, addr) = ensure_crypto_wallet(&conn, "default_user", asset);

    Json(json!({
        "success": true,
        "accountId": acc_id,
        "walletAddress": addr,
        "asset": asset,
        "network": "Celo EVM Mainnet",
        "minDeposit": "0.01 cUSD / 0.01 CELO"
    }))
}

#[derive(Deserialize)]
struct CryptoReceivePayload {
    pub amount: Decimal,
    #[serde(rename = "txHash")]
    pub tx_hash: String,
    #[serde(rename = "fromAddress")]
    pub from_address: String,
    pub asset: Option<String>,
}

async fn crypto_receive(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CryptoReceivePayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    let asset = payload.asset.as_deref().unwrap_or("cUSD");

    match deposit_onchain(&mut conn, "default_user", &payload.tx_hash, asset, payload.amount, &payload.from_address) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct CryptoSendPayload {
    #[serde(rename = "recipientAddress")]
    pub recipient_address: String,
    pub amount: Decimal,
    pub asset: Option<String>,
}

async fn crypto_send(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CryptoSendPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    let asset = payload.asset.as_deref().unwrap_or("cUSD");

    match withdraw_onchain(&mut conn, "default_user", &payload.recipient_address, asset, payload.amount) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct CryptoBuyPayload {
    #[serde(rename = "fiatAmount")]
    pub fiat_amount: Decimal,
    #[serde(rename = "cryptoAsset")]
    pub crypto_asset: String,
}

async fn crypto_buy(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CryptoBuyPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    let prices = get_crypto_prices();
    let price = prices.get(&payload.crypto_asset).map(|p| p.price_usd).unwrap_or(Decimal::ONE);
    let crypto_amt = (payload.fiat_amount / price).round_dp(6);

    match trade_crypto_buy_sell(&mut conn, "default_user", "BUY", &payload.crypto_asset, crypto_amt, "acc_bank_operating") {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct CryptoSellPayload {
    #[serde(rename = "cryptoAmount")]
    pub crypto_amount: Decimal,
    #[serde(rename = "cryptoAsset")]
    pub crypto_asset: String,
}

async fn crypto_sell(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CryptoSellPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();

    match trade_crypto_buy_sell(&mut conn, "default_user", "SELL", &payload.crypto_asset, payload.crypto_amount, "acc_bank_operating") {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct CryptoSwapPayload {
    #[serde(rename = "fromAsset")]
    pub from_asset: String,
    #[serde(rename = "toAsset")]
    pub to_asset: String,
    #[serde(rename = "fromAmount")]
    pub from_amount: Decimal,
}

async fn crypto_swap(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CryptoSwapPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    let prices = get_crypto_prices();
    let from_price = prices.get(&payload.from_asset).map(|p| p.price_usd).unwrap_or(Decimal::ONE);
    let to_price = prices.get(&payload.to_asset).map(|p| p.price_usd).unwrap_or(Decimal::ONE);

    let usd_val = payload.from_amount * from_price;
    let target_amt = (usd_val / to_price).round_dp(6);

    // Execute Sell -> Buy sequence
    let _ = trade_crypto_buy_sell(&mut conn, "default_user", "SELL", &payload.from_asset, payload.from_amount, "acc_bank_operating");
    match trade_crypto_buy_sell(&mut conn, "default_user", "BUY", &payload.to_asset, target_amt, "acc_bank_operating") {
        Ok(res) => Json(json!({
            "success": true,
            "swapId": format!("SWAP_{}", uuid::Uuid::new_v4()),
            "fromAsset": payload.from_asset,
            "toAsset": payload.to_asset,
            "swappedAmount": target_amt,
            "message": format!("Swapped {} {} for {} {} on Celo DEX", payload.from_amount, payload.from_asset, target_amt, payload.to_asset)
        })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct PaylinkPayload {
    pub amount: Decimal,
    pub currency: Option<String>,
    pub description: Option<String>,
}

async fn fintech_paylink(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<PaylinkPayload>,
) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let req = PaymentLinkRequest {
        title: payload.description.clone().unwrap_or_else(|| "Invoice Payment".into()),
        description: payload.description,
        amount: payload.amount,
        currency: payload.currency.unwrap_or_else(|| "USD".into()),
        platform: "paystack".to_string(),
    };

    match create_payment_link(&conn, "default_user", req) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct SendP2pPayload {
    pub platform: String,
    #[serde(rename = "recipientHandle")]
    pub recipient_handle: String,
    pub amount: Decimal,
    pub currency: Option<String>,
}

async fn fintech_p2p(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SendP2pPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    let req = P2PTransferRequest {
        platform: payload.platform,
        recipient_email_or_handle: payload.recipient_handle,
        amount: payload.amount,
        currency: payload.currency.unwrap_or_else(|| "USD".into()),
        note: None,
    };

    match send_fintech_p2p(&mut conn, "default_user", "acc_bank_operating", req) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

async fn rail_transactions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    match get_user_rail_transactions(&conn, "default_user", 50) {
        Ok(txs) => Json(json!({ "success": true, "transactions": txs })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
    }
}

// ----------------------------------------------------------------------------
// 5. Statement Engine Handlers
// ----------------------------------------------------------------------------
async fn parse_statement_handler(mut multipart: Multipart) -> impl IntoResponse {
    let mut content = String::new();
    let mut filename = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("statement") || field.name() == Some("file") {
            filename = field.file_name().map(|s| s.to_string());
            if let Ok(bytes) = field.bytes().await {
                content = String::from_utf8_lossy(&bytes).to_string();
            }
        }
    }

    if content.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "No file uploaded or empty file content" }))).into_response();
    }

    let parse_res = crate::statement_engine::parser::parse_statement(&content, filename.as_deref(), "USD");
    Json(json!({ "success": true, "parsed": parse_res })).into_response()
}

#[derive(Deserialize)]
struct ImportStatementPayload {
    #[serde(rename = "accountId")]
    pub account_id: String,
    pub content: String,
    pub filename: Option<String>,
}

async fn import_statement_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ImportStatementPayload>,
) -> impl IntoResponse {
    let mut conn = state.pool.get().unwrap();
    match import_bank_statement(&mut conn, "default_user", &payload.account_id, &payload.content, payload.filename.as_deref()) {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

// ----------------------------------------------------------------------------
// 6. Research Engine Handlers
// ----------------------------------------------------------------------------
#[derive(Deserialize)]
struct ForecastQuery {
    pub horizon: Option<u32>,
}

async fn research_forecast(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ForecastQuery>,
) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    let horizon = q.horizon.unwrap_or(90);

    match generate_cash_flow_forecast(&conn, "default_user", horizon) {
        Ok(res) => Json(json!({ "success": true, "forecast": res })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
    }
}

async fn research_monte_carlo(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MonteCarloInput>,
) -> impl IntoResponse {
    let res = run_monte_carlo_simulation(payload);
    Json(json!({ "success": true, "simulation": res }))
}

async fn research_health_score(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    match calculate_financial_health_score(&conn, "default_user") {
        Ok(h) => Json(json!({ "success": true, "health": { "score": h.overall_score, "grade": h.grade, "status": h.status, "currentCash": h.current_cash, "monthlyBurnRate": h.monthly_burn_rate, "runwayMonths": h.runway_months, "breakdown": h.breakdown, "recommendations": h.recommendations } })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
    }
}

async fn research_subscriptions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    match detect_subscriptions(&conn, "default_user") {
        Ok(subs) => Json(json!({ "success": true, "subscriptions": subs })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
    }
}

async fn research_anomalies(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = state.pool.get().unwrap();
    match detect_transaction_anomalies(&conn, "default_user") {
        Ok(alerts) => Json(json!({ "success": true, "anomalies": alerts })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
    }
}
