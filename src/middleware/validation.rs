// ============================================================================
// Financial Validation & Trading Leverage Guard Middleware
// Enforces bounds, input sanitization, and trading bot leverage safety constraints
// ============================================================================
use rust_decimal::Decimal;

/// Trading bot leverage safety rule:
/// Default bounds: 20x min, 25x max for automated bot execution.
#[allow(dead_code)]
pub const DEFAULT_BOT_LEVERAGE_MIN: u32 = 20;
#[allow(dead_code)]
pub const DEFAULT_BOT_LEVERAGE_MAX: u32 = 25;

/// Validate trading bot leverage parameter against risk management rules.
/// Returns Ok(leverage) if valid, or Err(message) if outside the 20x-25x corridor.
#[allow(dead_code)]
pub fn validate_bot_leverage(leverage: u32, min_allowed: u32, max_allowed: u32) -> Result<u32, String> {
    if leverage < min_allowed {
        return Err(format!(
            "Leverage {}x is below the required safety threshold (minimum {}x).",
            leverage, min_allowed
        ));
    }
    if leverage > max_allowed {
        return Err(format!(
            "Leverage {}x exceeds the maximum permitted bot leverage cap (maximum {}x). For safety, trading bots are capped at 25x.",
            leverage, max_allowed
        ));
    }
    Ok(leverage)
}

/// Validate transaction amount to ensure positive value and not exceeding safety cap.
#[allow(dead_code)]
pub fn validate_transaction_amount(amount: Decimal, max_threshold: Decimal) -> Result<Decimal, String> {
    if amount <= Decimal::ZERO {
        return Err("Transaction amount must be strictly greater than zero.".to_string());
    }
    if amount > max_threshold {
        return Err(format!(
            "Transaction amount {} exceeds the maximum transaction safety threshold of {}.",
            amount, max_threshold
        ));
    }
    Ok(amount)
}

/// Sanitize text inputs by removing dangerous control characters and trimming whitespace.
#[allow(dead_code)]
pub fn sanitize_input_text(input: &str) -> String {
    input
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect::<String>()
        .trim()
        .to_string()
}
