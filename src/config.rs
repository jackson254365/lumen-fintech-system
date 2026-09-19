// ============================================================================
// Lumen Fintech Rust System Configuration
// ============================================================================
use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub host: String,
    pub db_path: String,
    pub database_url: String,
    pub cors_origin: String,
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

        Config {
            port,
            host,
            db_path,
            database_url,
            cors_origin,
        }
    }
}

pub fn load_config() -> Config {
    Config::from_env()
}
