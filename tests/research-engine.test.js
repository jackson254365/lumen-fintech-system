// ============================================================================
// Computational Research Engine Tests
// ============================================================================
const assert = require('assert');
const { holtWintersForecast } = require('../server/research-engine/forecast');
const { runMonteCarloSimulation } = require('../server/research-engine/monte-carlo');
const { calculateFinancialHealthScore } = require('../server/research-engine/health-score');
const { detectSubscriptions } = require('../server/research-engine/subscriptions');
const { detectSpendingAnomalies } = require('../server/research-engine/anomaly-detector');
const db = require('../server/db');

console.log('🧪 Running tests/research-engine.test.js...');

// 1. Test Holt-Winters Forecasting Algorithm
const historicalSeries = [5000, 5200, 5400, 5600, 5800, 6000];
const forecastResult = holtWintersForecast(historicalSeries, 3, 0.4, 0.2);

assert.strictEqual(forecastResult.forecast.length, 3);
assert.ok(forecastResult.forecast[0].value > 6000); // Trend is positive
assert.ok(forecastResult.forecast[0].lower95 <= forecastResult.forecast[0].value);
assert.ok(forecastResult.forecast[0].upper95 >= forecastResult.forecast[0].value);
console.log('  ✓ Holt-Winters Double Exponential Smoothing generated trending forecast with confidence bands');

// 2. Test Monte Carlo Simulation
const testUser = 'usr_alex_morgan'; // Uses seeded baseline
const simResult = runMonteCarloSimulation(testUser, {
  iterations: 500,
  horizonMonths: 12,
  incomeShockPct: -20, // 20% drop in income
  emergencyShockAmount: 2500
});

assert.strictEqual(simResult.samplePaths.length, 5);
assert.strictEqual(simResult.monthlyPercentiles.length, 13); // Month 0 to 12
assert.ok(simResult.results.solvencyProbability >= 0 && simResult.results.solvencyProbability <= 100);
assert.ok(typeof simResult.results.riskRating === 'string');
console.log(`  ✓ Monte Carlo simulation executed 500 stochastic paths (Solvency: ${simResult.results.solvencyProbability}%, Rating: ${simResult.results.riskRating})`);

// 3. Test Financial Health Scoring
const health = calculateFinancialHealthScore(testUser);
assert.ok(health.score >= 0 && health.score <= 100);
assert.ok(['A+', 'A', 'B+', 'B', 'C', 'D'].includes(health.grade));
assert.strictEqual(health.pillars.length, 5);
assert.ok(health.recommendations.length > 0);
console.log(`  ✓ Financial Health Index calculated: ${health.score}/100 (Grade: ${health.grade}) across 5 econometric pillars`);

// 4. Test Spending Anomalies Detector
const anomalies = detectSpendingAnomalies(testUser, 1.5);
assert.ok(Array.isArray(anomalies.anomalies));
console.log(`  ✓ Anomaly detector evaluated categories and identified ${anomalies.anomaliesCount} statistical outliers`);

console.log('🎉 tests/research-engine.test.js PASSED!\n');
