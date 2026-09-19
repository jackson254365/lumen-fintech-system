// ============================================================================
// Monte Carlo Cash Flow Risk Simulation Engine in Rust
// Stochastic modeling of revenue volatility, expense shocks, and insolvency probability
// ============================================================================
use rand::Rng;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonteCarloInput {
    pub initial_balance: Decimal,
    pub expected_daily_revenue: Decimal,
    pub revenue_std_dev: Decimal,
    pub expected_daily_expenses: Decimal,
    pub expense_std_dev: Decimal,
    pub simulation_days: u32,
    pub num_simulations: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonteCarloResult {
    pub total_simulations: u32,
    pub simulation_days: u32,
    pub insolvency_probability_percent: f64,
    pub p10_ending_balance: Decimal,
    pub p50_ending_balance: Decimal,
    pub p90_ending_balance: Decimal,
    pub mean_ending_balance: Decimal,
    pub min_observed_balance: Decimal,
    pub max_observed_balance: Decimal,
}

pub fn run_monte_carlo_simulation(params: MonteCarloInput) -> MonteCarloResult {
    let mut rng = rand::thread_rng();
    let num_sims = params.num_simulations.max(100);
    let mut ending_balances = Vec::with_capacity(num_sims as usize);
    let mut insolvent_count = 0;

    let init_bal = params.initial_balance.to_string().parse::<f64>().unwrap_or(0.0);
    let mean_rev = params.expected_daily_revenue.to_string().parse::<f64>().unwrap_or(0.0);
    let std_rev = params.revenue_std_dev.to_string().parse::<f64>().unwrap_or(0.0);
    let mean_exp = params.expected_daily_expenses.to_string().parse::<f64>().unwrap_or(0.0);
    let std_exp = params.expense_std_dev.to_string().parse::<f64>().unwrap_or(0.0);

    let mut overall_min = init_bal;
    let mut overall_max = init_bal;

    for _ in 0..num_sims {
        let mut bal = init_bal;
        let mut went_insolvent = false;

        for _ in 0..params.simulation_days {
            // Box-Muller normal distribution sample
            let u1: f64 = rng.gen();
            let u2: f64 = rng.gen();
            let z0 = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos();
            let z1 = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).sin();

            let daily_rev = (mean_rev + z0 * std_rev).max(0.0);
            let daily_exp = (mean_exp + z1 * std_exp).max(0.0);

            bal += daily_rev - daily_exp;
            if bal < 0.0 {
                went_insolvent = true;
            }
        }

        if went_insolvent {
            insolvent_count += 1;
        }

        if bal < overall_min {
            overall_min = bal;
        }
        if bal > overall_max {
            overall_max = bal;
        }

        ending_balances.push(bal);
    }

    ending_balances.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let p10_idx = ((num_sims as f64) * 0.10) as usize;
    let p50_idx = ((num_sims as f64) * 0.50) as usize;
    let p90_idx = ((num_sims as f64) * 0.90) as usize;

    let sum: f64 = ending_balances.iter().sum();
    let mean_bal = sum / (num_sims as f64);

    let insol_prob = (insolvent_count as f64 / num_sims as f64) * 100.0;

    let to_decimal = |val: f64| -> Decimal {
        format!("{:.2}", val).parse::<Decimal>().unwrap_or(Decimal::ZERO)
    };

    MonteCarloResult {
        total_simulations: num_sims,
        simulation_days: params.simulation_days,
        insolvency_probability_percent: (insol_prob * 100.0).round() / 100.0,
        p10_ending_balance: to_decimal(ending_balances[p10_idx.min(num_sims as usize - 1)]),
        p50_ending_balance: to_decimal(ending_balances[p50_idx.min(num_sims as usize - 1)]),
        p90_ending_balance: to_decimal(ending_balances[p90_idx.min(num_sims as usize - 1)]),
        mean_ending_balance: to_decimal(mean_bal),
        min_observed_balance: to_decimal(overall_min),
        max_observed_balance: to_decimal(overall_max),
    }
}
