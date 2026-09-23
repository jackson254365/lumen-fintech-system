// ============================================================================
// Lumen Fintech Rust System Configuration & Security Policy
// ============================================================================
use std::env;

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub host: String,
    pub db_path: String,
    pub database_url: String,
    pub cors_origin: String,
    pub api_key: Option<String>,
    pub rate_limit_per_minute: u32,
    pub min_bot_leverage: u32,
    pub max_bot_leverage: u32,
    pub max_single_transaction: f64,
}

impl Config {
    pub fn from_env() -> Self {
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);

        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let db_path = env::var("DB_PATH").unwrap_or_else(|_| "./data/lumen.sqlite".to_string());
        let cors_origin = env::var("CORS_ORIGIN").unwrap_or_else(|_| "*".to_string());
        let database_url = db_path.clone();

        let api_key = env::var("LUMEN_API_KEY")
            .or_else(|_| env::var("FINTECH_API_KEY"))
            .ok()
            .filter(|k| !k.trim().is_empty());

        let rate_limit_per_minute = env::var("RATE_LIMIT_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(120);

        let min_bot_leverage = env::var("MIN_BOT_LEVERAGE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(20);

        let max_bot_leverage = env::var("MAX_BOT_LEVERAGE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(25);

        let max_single_transaction = env::var("MAX_SINGLE_TRANSACTION")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1_000_000.0);

        Config {
            port,
            host,
            db_path,
            database_url,
            cors_origin,
            api_key,
            rate_limit_per_minute,
            min_bot_leverage,
            max_bot_leverage,
            max_single_transaction,
        }
    }
}

pub fn load_config() -> Config {
    Config::from_env()
}
