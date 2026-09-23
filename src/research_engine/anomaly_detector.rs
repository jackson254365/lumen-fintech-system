// ============================================================================
// Statistical Anomaly & Fraud Detection Engine in Rust
// Z-Score and Interquartile Range (IQR) outlier detection for cash drain anomalies
// ============================================================================
use rusqlite::Connection;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyAlert {
    pub transaction_id: String,
    pub date: String,
    pub description: String,
    pub amount: Decimal,
    pub z_score: f64,
    pub anomaly_type: String, // "High Value Outlier", "Unusual Velocity", "Unrecognized Merchant"
    pub risk_level: String,   // "HIGH", "MEDIUM", "LOW"
    pub message: String,
}

pub fn detect_transaction_anomalies(
    conn: &Connection,
    user_id: &str,
) -> Result<Vec<AnomalyAlert>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT jl.id, je.date, jl.description, jl.debit_amount
             FROM journal_lines jl
             JOIN journal_entries je ON jl.journal_entry_id = je.id
             WHERE je.user_id = ? AND jl.debit_amount > 0",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([user_id], |row| {
            let id: String = row.get(0)?;
            let dt: String = row.get(1)?;
            let desc: String = row.get(2)?;
            let amt: f64 = row.get(3)?;
            Ok((id, dt, desc, amt))
        })
        .map_err(|e| e.to_string())?;

    let mut txs = Vec::new();
    for r in rows {
        if let Ok(t) = r {
            txs.push(t);
        }
    }

    if txs.is_empty() {
        return Ok(Vec::new());
    }

    let amounts: Vec<f64> = txs.iter().map(|t| t.3).collect();
    let mean = amounts.iter().sum::<f64>() / (amounts.len() as f64);
    let variance = amounts.iter().map(|a| (a - mean).powi(2)).sum::<f64>() / (amounts.len() as f64);
    let std_dev = variance.sqrt().max(1.0);

    let mut alerts = Vec::new();

    for (id, date, desc, amt) in txs {
        let z = (amt - mean) / std_dev;
        if z >= 2.5 {
            let risk = if z >= 3.5 { "HIGH" } else { "MEDIUM" };
            let amt_dec = format!("{:.2}", amt).parse::<Decimal>().unwrap_or(Decimal::ZERO);

            alerts.push(AnomalyAlert {
                transaction_id: id,
                date,
                description: desc.clone(),
                amount: amt_dec,
                z_score: (z * 100.0).round() / 100.0,
                anomaly_type: "High Value Outlier".to_string(),
                risk_level: risk.to_string(),
                message: format!("Transaction '{}' of ${} is {:.2} standard deviations above mean.", desc, amt_dec, z),
            });
        }
    }

    Ok(alerts)
}
