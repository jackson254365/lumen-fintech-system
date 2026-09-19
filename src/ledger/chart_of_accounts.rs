// ============================================================================
// Chart of Accounts & Accounting Normal Balance Classification
// GAAP / IFRS Standard Classifications and Trial Balance Reporting
// ============================================================================
use rusqlite::{params, Connection};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountClass {
    Asset,
    Liability,
    Equity,
    Revenue,
    Expense,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NormalBalance {
    Debit,
    Credit,
}

impl AccountClass {
    pub fn normal_balance(&self) -> NormalBalance {
        match self {
            AccountClass::Asset => NormalBalance::Debit,
            AccountClass::Liability => NormalBalance::Credit,
            AccountClass::Equity => NormalBalance::Credit,
            AccountClass::Revenue => NormalBalance::Credit,
            AccountClass::Expense => NormalBalance::Debit,
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "asset" => AccountClass::Asset,
            "liability" => AccountClass::Liability,
            "equity" => AccountClass::Equity,
            "revenue" => AccountClass::Revenue,
            "expense" => AccountClass::Expense,
            _ => AccountClass::Asset,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            AccountClass::Asset => "asset",
            AccountClass::Liability => "liability",
            AccountClass::Equity => "equity",
            AccountClass::Revenue => "revenue",
            AccountClass::Expense => "expense",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialBalanceLine {
    pub account_id: String,
    pub account_name: String,
    pub account_class: String,
    pub ending_balance: Decimal,
    pub debit: Decimal,
    pub credit: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialBalanceReport {
    pub lines: Vec<TrialBalanceLine>,
    pub total_debits: Decimal,
    pub total_credits: Decimal,
    pub in_equilibrium: bool,
}

pub fn generate_trial_balance(conn: &Connection, user_id: &str) -> Result<TrialBalanceReport, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.account_code, p.direction, SUM(p.amount)
             FROM postings p
             JOIN journal_entries j ON p.journal_entry_id = j.id
             WHERE j.user_id = ?
             GROUP BY p.account_code, p.direction",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, f64)> = stmt
        .query_map([user_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut line_map: HashMap<String, (Decimal, Decimal)> = HashMap::new();
    let mut total_debits = Decimal::ZERO;
    let mut total_credits = Decimal::ZERO;

    for (code, dir, amt_f) in rows {
        let dec_amt = Decimal::from_f64(amt_f).unwrap_or(Decimal::ZERO);
        let entry = line_map.entry(code).or_insert((Decimal::ZERO, Decimal::ZERO));

        if dir == "debit" {
            entry.0 += dec_amt;
            total_debits += dec_amt;
        } else {
            entry.1 += dec_amt;
            total_credits += dec_amt;
        }
    }

    let mut lines = Vec::new();
    for (code, (deb, cred)) in line_map {
        let cls = code.split(':').next().unwrap_or("asset").to_string();
        let name = code.split(':').nth(1).unwrap_or(&code).to_string();
        let ending = deb - cred;

        lines.push(TrialBalanceLine {
            account_id: code,
            account_name: name,
            account_class: cls,
            ending_balance: ending,
            debit: deb,
            credit: cred,
        });
    }

    let diff = (total_debits - total_credits).abs();
    let in_equilibrium = diff < Decimal::new(1, 2); // < 0.01

    Ok(TrialBalanceReport {
        lines,
        total_debits,
        total_credits,
        in_equilibrium,
    })
}
