// ============================================================================
// Rust Integration Test Suite for Lumen Fintech System
// Verifies GAAP equilibrium, SHA-256 audit chain, multi-rails, & Web3 crypto
// ============================================================================
use lumen_fintech_system::db::init_db;
use lumen_fintech_system::ledger::audit_chain::verify_audit_chain;
use lumen_fintech_system::ledger::chart_of_accounts::generate_trial_balance;
use lumen_fintech_system::ledger::core::{
    create_account, get_account_balance, record_income, record_spending,
};
use lumen_fintech_system::rails::airtel::initiate_airtel_collection;
use lumen_fintech_system::rails::crypto::deposit_onchain;
use lumen_fintech_system::rails::mpesa::initiate_stk_push;
use lumen_fintech_system::research_engine::{
    calculate_financial_health_score, generate_cash_flow_forecast, run_monte_carlo_simulation,
    MonteCarloInput,
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

#[test]
fn test_double_entry_ledger_equilibrium() {
    let pool = init_db(":memory:").expect("Failed to create in-memory database");
    let mut conn = pool.get().expect("Failed to get DB connection");

    let bank_acc = create_account(
        &mut conn,
        "test_user",
        "Operating Bank",
        "checking",
        "USD",
        "Chase",
        dec!(10000.00),
    )
    .expect("Failed to create account");

    let spend_res = record_spending(
        &mut conn,
        "test_user",
        &bank_acc.id,
        dec!(250.50),
        "AWS Cloud Services",
        "Monthly hosting server cost",
        None,
        Some("REF_AWS_001".to_string()),
        "server",
        "blue",
    )
    .expect("Failed to record spending");

    assert_eq!(spend_res.amount.abs(), dec!(250.50));

    let tb = generate_trial_balance(&conn, "test_user").expect("Trial balance failed");
    assert!(tb.in_equilibrium, "Trial balance MUST be in equilibrium");

    let new_bal = get_account_balance(&conn, &bank_acc.id).expect("Get balance failed");
    assert_eq!(new_bal, dec!(9749.50));
}

#[test]
fn test_sha256_audit_chain_integrity() {
    let pool = init_db(":memory:").expect("Failed to create DB");
    let mut conn = pool.get().unwrap();

    let bank_acc = create_account(&mut conn, "test_user", "Vault", "checking", "USD", "Fed", dec!(5000)).unwrap();

    for i in 1..=5 {
        record_income(
            &mut conn,
            "test_user",
            &bank_acc.id,
            Decimal::from(i * 100),
            "Client Payment",
            &format!("Invoice #{}", i),
            None,
            Some(format!("INV_{}", i)),
            "download",
            "emerald",
        )
        .unwrap();
    }

    let audit_res = verify_audit_chain(&conn, "test_user");
    assert!(audit_res.valid, "SHA-256 cryptographic audit chain must be 100% valid");
    assert_eq!(audit_res.entries_verified, 6); // Opening equity + 5 transactions
}

#[test]
fn test_multi_rail_mpesa_airtel_bank_crypto() {
    let pool = init_db(":memory:").expect("Failed to create DB");
    let mut conn = pool.get().unwrap();

    // M-Pesa STK push
    let stk_res = initiate_stk_push(&conn, "test_user", "0712345678", 5000, Some("Topup")).unwrap();
    assert!(stk_res.success);
    assert_eq!(stk_res.phone_number, "254712345678");

    // Airtel Collection
    let airtel_res = initiate_airtel_collection(&conn, "test_user", "256770000000", 10000, "UGX").unwrap();
    assert!(airtel_res.success);

    // Crypto On-Chain Deposit on Celo Network
    let deposit_res = deposit_onchain(
        &mut conn,
        "test_user",
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        "cUSD",
        dec!(100.00),
        "0x0000000000000000000000000000000000000000",
    )
    .unwrap();
    assert!(deposit_res.success);
    assert_eq!(deposit_res.token_symbol.to_uppercase(), "CUSD");
}

#[test]
fn test_computational_research_engine() {
    let pool = init_db(":memory:").expect("Failed to create DB");
    let conn = pool.get().unwrap();

    let forecast = generate_cash_flow_forecast(&conn, "default_user", 90).unwrap();
    assert_eq!(forecast.daily_points.len(), 90);

    let monte_carlo = run_monte_carlo_simulation(MonteCarloInput {
        initial_balance: dec!(10000),
        expected_daily_revenue: dec!(200),
        revenue_std_dev: dec!(50),
        expected_daily_expenses: dec!(120),
        expense_std_dev: dec!(30),
        simulation_days: 30,
        num_simulations: 500,
    });
    assert_eq!(monte_carlo.total_simulations, 500);

    let health = calculate_financial_health_score(&conn, "default_user").unwrap();
    assert!(health.overall_score > 0);
}

#[test]
fn test_user_auth_and_admin_system() {
    let pool = init_db(":memory:").expect("Failed to create DB");
    let conn = pool.get().unwrap();

    let user_count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap();
    assert!(user_count >= 2, "Default users must be seeded");

    let admin_exists: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM users WHERE role = 'admin')", [], |r| r.get(0))
        .unwrap();
    assert!(admin_exists, "Admin user must exist in users table");
}

#[test]
fn test_security_mechanisms_and_leverage_corridor() {
    use lumen_fintech_system::middleware::auth::{constant_time_eq, IdempotencyStore};
    use lumen_fintech_system::middleware::rate_limiter::RateLimiter;
    use lumen_fintech_system::middleware::validation::{
        sanitize_input_text, validate_bot_leverage, validate_transaction_amount,
    };

    // 1. Constant-Time API Key Comparison
    assert!(constant_time_eq(b"secret_api_key_123", b"secret_api_key_123"));
    assert!(!constant_time_eq(b"secret_api_key_123", b"wrong_api_key_456"));
    assert!(!constant_time_eq(b"short", b"longer_key"));

    // 2. Idempotency Key deduplication
    let idem_store = IdempotencyStore::new();
    assert!(idem_store.check_and_record("req_idem_key_abc_123"));
    // Second attempt with same key must return false (duplicate detected)
    assert!(!idem_store.check_and_record("req_idem_key_abc_123"));
    // Different key must succeed
    assert!(idem_store.check_and_record("req_idem_key_xyz_789"));

    // 3. Rate Limiter Token Bucket
    let limiter = RateLimiter::new(20);
    let (limit, remaining) = limiter.check("192.168.1.50", false).unwrap();
    assert_eq!(limit, 20);
    assert_eq!(remaining, 19);

    // 4. Trading Bot Leverage Guard: 20x-25x Corridor rule
    // Inside corridor (20x - 25x) -> Valid
    assert!(validate_bot_leverage(20, 20, 25).is_ok());
    assert!(validate_bot_leverage(22, 20, 25).is_ok());
    assert!(validate_bot_leverage(25, 20, 25).is_ok());
    // Below corridor (< 20x) -> Rejected
    assert!(validate_bot_leverage(10, 20, 25).is_err());
    // Above corridor (> 25x, e.g. 50x or 125x) -> Rejected for bot execution
    assert!(validate_bot_leverage(50, 20, 25).is_err());
    assert!(validate_bot_leverage(125, 20, 25).is_err());

    // 5. Transaction amount validation and text sanitization
    assert!(validate_transaction_amount(dec!(100.0), dec!(1000000.0)).is_ok());
    assert!(validate_transaction_amount(dec!(-5.0), dec!(1000000.0)).is_err());
    assert!(validate_transaction_amount(dec!(2000000.0), dec!(1000000.0)).is_err());

    let sanitized = sanitize_input_text("  Payment for \x00Server\x1b Hosting  ");
    assert_eq!(sanitized, "Payment for Server Hosting");
}
