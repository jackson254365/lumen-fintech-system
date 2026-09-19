// ============================================================================
// Computational Finance Research Routes
// Predictive modeling, stochastic stress testing, econometric scoring, and anomaly detection
// ============================================================================
const express = require('express');
const { generateCashFlowForecast } = require('../research-engine/forecast');
const { runMonteCarloSimulation } = require('../research-engine/monte-carlo');
const { calculateFinancialHealthScore } = require('../research-engine/health-score');
const { detectSubscriptions } = require('../research-engine/subscriptions');
const { detectSpendingAnomalies } = require('../research-engine/anomaly-detector');
const { BASE_RATES_USD, getExchangeRate, convertAmount } = require('../research-engine/currency');

const router = express.Router();

/**
 * Time-Series Cash Flow Forecasting
 */
router.get('/forecast', (req, res, next) => {
  try {
    const horizon = Number(req.query.horizon) || 6;
    const forecastData = generateCashFlowForecast(req.user.id, horizon);
    res.json({
      success: true,
      forecast: forecastData
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Monte Carlo Runway & Stochastic Stress Testing
 */
router.post('/monte-carlo', (req, res, next) => {
  try {
    const {
      iterations = 1000,
      horizonMonths = 12,
      incomeShockPct = 0,
      emergencyShockAmount = 0,
      emergencyProbPerYear = 0.5,
      inflationPct = 3.0
    } = req.body;

    const simulation = runMonteCarloSimulation(req.user.id, {
      iterations: Math.min(5000, Math.max(100, Number(iterations))),
      horizonMonths: Math.min(36, Math.max(3, Number(horizonMonths))),
      incomeShockPct: Number(incomeShockPct),
      emergencyShockAmount: Math.max(0, Number(emergencyShockAmount)),
      emergencyProbPerYear: Math.max(0, Math.min(1.0, Number(emergencyProbPerYear))),
      inflationPct: Number(inflationPct)
    });

    res.json({
      success: true,
      simulation
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Financial Health Score & Ratios
 */
router.get('/health-score', (req, res, next) => {
  try {
    const health = calculateFinancialHealthScore(req.user.id);
    res.json({
      success: true,
      health
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Recurring Subscriptions & Fixed Burn Detection
 */
router.get('/subscriptions', (req, res, next) => {
  try {
    const result = detectSubscriptions(req.user.id);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Statistical Spending Anomalies & Outliers
 */
router.get('/anomalies', (req, res, next) => {
  try {
    const threshold = Number(req.query.threshold) || 2.2;
    const anomalies = detectSpendingAnomalies(req.user.id, threshold);
    res.json({
      success: true,
      anomalies
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Currency Exchange Rates
 */
router.get('/currencies', (req, res) => {
  const { from = 'USD', to = 'EUR', amount = 1.0 } = req.query;
  const rate = getExchangeRate(from, to);
  const converted = convertAmount(Number(amount), from, to);

  res.json({
    success: true,
    baseCurrency: 'USD',
    rates: BASE_RATES_USD,
    conversion: {
      from,
      to,
      amount: Number(amount),
      rate: Number(rate.toFixed(4)),
      converted: Number(converted.toFixed(2))
    }
  });
});

module.exports = router;
