// ============================================================================
// Computational Finance: Spending Anomaly & Outlier Detector
// Identifies statistical outliers using rolling category Z-scores and IQR bounds
// ============================================================================
const db = require('../db');

function detectSpendingAnomalies(userId, zThreshold = 2.2) {
  // Fetch spending transactions
  const rows = db.query(
    `SELECT id, date, name, category, amount
     FROM transactions
     WHERE user_id = ? AND amount < 0 AND category != 'Internal transfer'
     ORDER BY date DESC`,
    [userId]
  );

  // Group by category to compute statistical distributions
  const categoryStats = {};
  for (const r of rows) {
    const amt = Math.abs(r.amount);
    if (!categoryStats[r.category]) {
      categoryStats[r.category] = [];
    }
    categoryStats[r.category].push(amt);
  }

  const categoryMetrics = {};
  for (const [cat, amounts] of Object.entries(categoryStats)) {
    if (amounts.length < 2) continue;
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / amounts.length;
    const std = Math.sqrt(variance);

    // Median
    const sorted = [...amounts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    categoryMetrics[cat] = { mean, std, median, count: amounts.length };
  }

  const anomalies = [];

  for (const r of rows) {
    const amt = Math.abs(r.amount);
    const metrics = categoryMetrics[r.category];

    if (!metrics || metrics.std === 0) continue;

    const zScore = (amt - metrics.mean) / metrics.std;
    const ratioToMedian = amt / metrics.median;

    if (zScore >= zThreshold || (ratioToMedian >= 3.0 && amt > 100)) {
      anomalies.push({
        id: r.id,
        date: r.date,
        name: r.name,
        category: r.category,
        amount: amt,
        zScore: Number(zScore.toFixed(2)),
        categoryMean: Number(metrics.mean.toFixed(2)),
        categoryMedian: Number(metrics.median.toFixed(2)),
        severity: zScore >= 3.0 ? 'high' : 'medium',
        reason: zScore >= 3.0
          ? `Extreme outlier: ${zScore.toFixed(1)} standard deviations above mean for ${r.category}`
          : `Unusual transaction: ${ratioToMedian.toFixed(1)}x greater than median ${r.category} spend`
      });
    }
  }

  return {
    anomaliesCount: anomalies.length,
    anomalies,
    evaluatedCategories: Object.keys(categoryMetrics)
  };
}

module.exports = {
  detectSpendingAnomalies
};
