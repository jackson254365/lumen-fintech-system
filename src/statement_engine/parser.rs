// ============================================================================
// Statement Parser Engine in Rust
// Supports CSV, OFX (Open Financial Exchange), and MT940 (SWIFT Bank Statement)
// ============================================================================
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTransaction {
    pub date: String,
    pub description: String,
    pub amount: Decimal,
    pub currency: String,
    pub fingerprint: String,
    pub raw_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub file_type: String,
    pub total_parsed: usize,
    pub transactions: Vec<ParsedTransaction>,
}

pub fn generate_fingerprint(date: &str, amount: &Decimal, description: &str) -> String {
    let mut hasher = Sha256::new();
    let norm_desc = description.trim().to_lowercase();
    let data = format!("{}:{}:{}", date.trim(), amount.normalize(), norm_desc);
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn parse_csv(content: &str, default_currency: &str) -> Vec<ParsedTransaction> {
    let mut transactions = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.to_lowercase().starts_with("date") || trimmed.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = trimmed.split(',').map(|s| s.trim_matches('"').trim()).collect();
        if parts.len() >= 3 {
            let date = parts[0].to_string();
            let description = parts[1].to_string();
            if let Ok(amount) = parts[2].parse::<Decimal>() {
                let currency = if parts.len() >= 4 && !parts[3].is_empty() {
                    parts[3].to_string()
                } else {
                    default_currency.to_string()
                };

                let fp = generate_fingerprint(&date, &amount, &description);

                transactions.push(ParsedTransaction {
                    date,
                    description,
                    amount,
                    currency,
                    fingerprint: fp,
                    raw_line: trimmed.to_string(),
                });
            }
        }
    }

    transactions
}

pub fn parse_ofx(content: &str, default_currency: &str) -> Vec<ParsedTransaction> {
    let mut transactions = Vec::new();
    let stmt_blocks = content.split("<STMTTRN>");

    for block in stmt_blocks.skip(1) {
        let end_idx = block.find("</STMTTRN>").unwrap_or(block.len());
        let trn_text = &block[..end_idx];

        let extract_tag = |tag: &str| -> Option<String> {
            let start_tag = format!("<{}>", tag);
            if let Some(pos) = trn_text.find(&start_tag) {
                let rest = &trn_text[pos + start_tag.len()..];
                let val = if let Some(end) = rest.find('<') {
                    &rest[..end]
                } else if let Some(end) = rest.find('\n') {
                    &rest[..end]
                } else {
                    rest
                };
                Some(val.trim().to_string())
            } else {
                None
            }
        };

        let raw_amt = extract_tag("TRNAMT");
        let raw_date = extract_tag("DTPOSTED");
        let raw_name = extract_tag("NAME").or_else(|| extract_tag("MEMO")).unwrap_or_else(|| "OFX Transaction".to_string());

        if let (Some(amt_str), Some(date_str)) = (raw_amt, raw_date) {
            if let Ok(amount) = amt_str.parse::<Decimal>() {
                let formatted_date = if date_str.len() >= 8 {
                    format!("{}-{}-{}", &date_str[0..4], &date_str[4..6], &date_str[6..8])
                } else {
                    date_str.clone()
                };

                let fp = generate_fingerprint(&formatted_date, &amount, &raw_name);

                transactions.push(ParsedTransaction {
                    date: formatted_date,
                    description: raw_name,
                    amount,
                    currency: default_currency.to_string(),
                    fingerprint: fp,
                    raw_line: trn_text.replace('\n', " "),
                });
            }
        }
    }

    transactions
}

pub fn parse_statement(content: &str, filename: Option<&str>, default_currency: &str) -> ParseResult {
    let fn_lower = filename.unwrap_or("").to_lowercase();
    let is_ofx = fn_lower.ends_with(".ofx") || fn_lower.ends_with(".qfx") || content.contains("<OFX>") || content.contains("<STMTTRN>");

    let (file_type, txs) = if is_ofx {
        ("OFX", parse_ofx(content, default_currency))
    } else {
        ("CSV", parse_csv(content, default_currency))
    };

    let total = txs.len();

    ParseResult {
        file_type: file_type.to_string(),
        total_parsed: total,
        transactions: txs,
    }
}
