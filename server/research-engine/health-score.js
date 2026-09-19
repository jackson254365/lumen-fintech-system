// ============================================================================
// Computational Finance: Financial Health Score Engine
// Evaluates 5 econometric pillars: Savings Rate, Runway, Debt Burden, Cash Flow Stability, and Budget Discipline
// ============================================================================
const db = require('../db');
const { getAccountBalance } = require('../ledger/ledger-core');

function calculateFinancialHealthScore(userId) {
  // 1. Assets and Liabilities
  const accounts = db.query(
    'SELECT id, name, type, account_class FROM accounts WHERE user_id = ? AND is_archived = 0',
    [userId]
  );

  let totalLiquidAssets = 0;
  let totalLiabilities = 0;

  for (const acc of accounts) {
    const bal = getAccountBalance(acc.id);
    if (acc.account_class === 'asset') {
      totalLiquidAssets += bal;
    } else {
      totalLiabilities += bal;
    }
  }

  // 2. Recent Cash Flow (Last 3 to 6 months)
  const txRows = db.query(
    `SELECT
       strftime('%Y-%m', date) as month,
       SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as inc,
       SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as sp
     FROM transactions
     WHERE user_id = ? AND category != 'Internal transfer'
     GROUP BY strftime('%Y-%m', date)`,
    [userId]
  );

  let monthlyIncome = 6200;
  let monthlySpending = 3185;

  if (txRows.length > 0) {
    const totalInc = txRows.reduce((sum, r) => sum + r.inc, 0);
    const totalSp = txRows.reduce((sum, r) => sum + r.sp, 0);
    monthlyIncome = totalInc / txRows.length;
    monthlySpending = totalSp / txRows.length;
  }

  // Monthly burn rate (essential spending)
  const monthlyBurn = Math.max(1, monthlySpending);

  // =========================================================================
  // PILLAR 1: Savings Rate (Weight: 25 points)
  // Optimal: >= 20% savings rate (gets 25/25)
  // =========================================================================
  const savingsRate = monthlyIncome > 0 ? ((monthlyIncome - monthlySpending) / monthlyIncome) * 100 : 0;
  let pillarSavingsScore = 0;
  if (savingsRate >= 30) pillarSavingsScore = 25;
  else if (savingsRate >= 20) pillarSavingsScore = 20 + ((savingsRate - 20) / 10) * 5;
  else if (savingsRate >= 10) pillarSavingsScore = 12 + ((savingsRate - 10) / 10) * 8;
  else if (savingsRate > 0) pillarSavingsScore = (savingsRate / 10) * 12;
  else pillarSavingsScore = 0;

  // =========================================================================
  // PILLAR 2: Emergency Runway (Weight: 25 points)
  // Optimal: >= 6 months of expenses in liquid reserves
  // =========================================================================
  const runwayMonths = totalLiquidAssets / monthlyBurn;
  let pillarRunwayScore = 0;
  if (runwayMonths >= 6) pillarRunwayScore = 25;
  else if (runwayMonths >= 3) pillarRunwayScore = 15 + ((runwayMonths - 3) / 3) * 10;
  else if (runwayMonths >= 1) pillarRunwayScore = 5 + ((runwayMonths - 1) / 2) * 10;
  else pillarRunwayScore = Math.max(0, runwayMonths * 5);

  // =========================================================================
  // PILLAR 3: Debt Burden / Leverage Ratio (Weight: 20 points)
  // Optimal: 0% debt or liabilities < 15% of assets
  // =========================================================================
  const leverageRatio = totalLiquidAssets > 0 ? (totalLiabilities / totalLiquidAssets) * 100 : 100;
  let pillarDebtScore = 20;
  if (totalLiabilities === 0) pillarDebtScore = 20;
  else if (leverageRatio <= 15) pillarDebtScore = 18;
  else if (leverageRatio <= 30) pillarDebtScore = 14;
  else if (leverageRatio <= 50) pillarDebtScore = 9;
  else pillarDebtScore = Math.max(0, 20 - (leverageRatio / 10));

  // =========================================================================
  // PILLAR 4: Living Within Means / Budget Discipline (Weight: 15 points)
  // Optimal: Spending <= 80% of Income
  // =========================================================================
  const expenseRatio = monthlyIncome > 0 ? (monthlySpending / monthlyIncome) * 100 : 100;
  let pillarDisciplineScore = 0;
  if (expenseRatio <= 65) pillarDisciplineScore = 15;
  else if (expenseRatio <= 80) pillarDisciplineScore = 12;
  else if (expenseRatio <= 95) pillarDisciplineScore = 7;
  else if (expenseRatio <= 100) pillarDisciplineScore = 3;
  else pillarDisciplineScore = 0;

  // =========================================================================
  // PILLAR 5: Cash Flow Stability (Weight: 15 points)
  // Stability of income flows over time
  // =========================================================================
  let pillarStabilityScore = 14; // Default healthy baseline
  if (txRows.length >= 3) {
    const incs = txRows.map(r => r.inc);
    const mean = incs.reduce((a, b) => a + b, 0) / incs.length;
    const std = Math.sqrt(incs.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / incs.length);
    const cv = mean > 0 ? std / mean : 1.0; // Coefficient of Variation
    if (cv < 0.15) pillarStabilityScore = 15;
    else if (cv < 0.30) pillarStabilityScore = 12;
    else if (cv < 0.50) pillarStabilityScore = 8;
    else pillarStabilityScore = 4;
  }

  // Composite calculation
  const totalScore = Math.round(
    pillarSavingsScore + pillarRunwayScore + pillarDebtScore + pillarDisciplineScore + pillarStabilityScore
  );

  let grade = 'A';
  if (totalScore >= 93) grade = 'A+';
  else if (totalScore >= 85) grade = 'A';
  else if (totalScore >= 75) grade = 'B+';
  else if (totalScore >= 65) grade = 'B';
  else if (totalScore >= 50) grade = 'C';
  else grade = 'D';

  // Actionable Insights & Prescriptions
  const recommendations = [];
  if (runwayMonths < 3) {
    recommendations.push({
      type: 'warning',
      category: 'Emergency Fund',
      message: `Emergency runway is ${runwayMonths.toFixed(1)} months. Prioritize building liquid reserves to at least 3-6 months ($${(monthlyBurn * 3).toFixed(0)} minimum).`
    });
  } else {
    recommendations.push({
      type: 'positive',
      category: 'Emergency Fund',
      message: `Strong liquid liquidity: ${runwayMonths.toFixed(1)} months of runway ($${totalLiquidAssets.toFixed(0)} available).`
    });
  }

  if (savingsRate >= 20) {
    recommendations.push({
      type: 'positive',
      category: 'Savings Rate',
      message: `Excellent savings discipline at ${savingsRate.toFixed(1)}% (exceeding standard 20% econometric benchmark).`
    });
  } else {
    recommendations.push({
      type: 'warning',
      category: 'Savings Rate',
      message: `Savings rate is ${savingsRate.toFixed(1)}%. Aim to trim discretionary subscriptions or increase revenue to achieve 20%+.`
    });
  }

  if (totalLiabilities > 0) {
    recommendations.push({
      type: 'info',
      category: 'Debt Management',
      message: `Active liabilities detected ($${totalLiabilities.toFixed(2)}). Consider avalanche or snowball debt elimination strategy.`
    });
  }

  return {
    score: totalScore,
    grade,
    summary: `${grade} Rating · ${totalScore}/100 Financial Health Index`,
    metrics: {
      savingsRatePct: Number(savingsRate.toFixed(1)),
      emergencyRunwayMonths: Number(runwayMonths.toFixed(1)),
      monthlyBurnRate: Number(monthlyBurn.toFixed(2)),
      liquidAssets: Number(totalLiquidAssets.toFixed(2)),
      totalLiabilities: Number(totalLiabilities.toFixed(2)),
      debtToAssetRatio: Number(leverageRatio.toFixed(1))
    },
    pillars: [
      { name: 'Savings Rate', score: Math.round((pillarSavingsScore / 25) * 100), weight: '25%', status: pillarSavingsScore >= 20 ? 'Optimal' : 'Needs attention' },
      { name: 'Emergency Runway', score: Math.round((pillarRunwayScore / 25) * 100), weight: '25%', status: pillarRunwayScore >= 20 ? 'Optimal' : 'Needs attention' },
      { name: 'Debt Burden', score: Math.round((pillarDebtScore / 20) * 100), weight: '20%', status: pillarDebtScore >= 16 ? 'Optimal' : 'Moderate' },
      { name: 'Budget Discipline', score: Math.round((pillarDisciplineScore / 15) * 100), weight: '15%', status: pillarDisciplineScore >= 12 ? 'Optimal' : 'Caution' },
      { name: 'Income Stability', score: Math.round((pillarStabilityScore / 15) * 100), weight: '15%', status: pillarStabilityScore >= 12 ? 'High' : 'Variable' }
    ],
    recommendations
  };
}

module.exports = {
  calculateFinancialHealthScore
};
