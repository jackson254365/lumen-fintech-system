// ============================================================================
// Statement Auto-Categorization Engine in Rust
// Heuristic and rule-based merchant transaction classifier
// ============================================================================
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryRule {
    pub category: String,
    pub keywords: Vec<String>,
    pub icon: String,
    pub color: String,
}

pub fn get_default_category_rules() -> Vec<CategoryRule> {
    vec![
        CategoryRule {
            category: "Payroll & Salary".to_string(),
            keywords: vec!["payroll".into(), "salary".into(), "stipend".into(), "wages".into(), "direct dep".into()],
            icon: "wallet".into(),
            color: "emerald".into(),
        },
        CategoryRule {
            category: "Cloud Infrastructure".to_string(),
            keywords: vec!["aws".into(), "amazon web".into(), "google cloud".into(), "azure".into(), "digitalocean".into(), "vercel".into(), "cloudflare".into()],
            icon: "server".into(),
            color: "blue".into(),
        },
        CategoryRule {
            category: "SaaS & Software".to_string(),
            keywords: vec!["github".into(), "slack".into(), "zoom".into(), "google workspace".into(), "atlassian".into(), "jetbrains".into(), "figma".into(), "openai".into()],
            icon: "code".into(),
            color: "purple".into(),
        },
        CategoryRule {
            category: "Mobile Money & Crypto".to_string(),
            keywords: vec!["m-pesa".into(), "mpesa".into(), "airtel".into(), "celo".into(), "binance".into(), "coinbase".into(), "crypto".into()],
            icon: "smartphone".into(),
            color: "amber".into(),
        },
        CategoryRule {
            category: "Office & Operations".to_string(),
            keywords: vec!["uber".into(), "bolt".into(), "flight".into(), "hotel".into(), "rent".into(), "utility".into(), "electricity".into(), "water".into()],
            icon: "building".into(),
            color: "orange".into(),
        },
    ]
}

pub fn categorize_transaction(description: &str) -> (String, String, String) {
    let lower_desc = description.to_lowercase();
    let rules = get_default_category_rules();

    for rule in rules {
        for kw in rule.keywords {
            if lower_desc.contains(&kw) {
                return (rule.category, rule.icon, rule.color);
            }
        }
    }

    ("General Expenses".to_string(), "tag".to_string(), "slate".to_string())
}
