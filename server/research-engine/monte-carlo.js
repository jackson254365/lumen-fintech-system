// ============================================================================
// Computational Finance: Monte Carlo Stochastic Runway & Stress Testing Simulation
// Simulates 1,000 financial trajectories with macro shocks, income disruptions, and emergency outlays
// ============================================================================
const db = require('../db');
const { getAccountBalance } = require('../ledger/ledger-core');

/**
 * Box-Muller transform to sample from standard normal distribution N(0, 1)
 */
function randomNormal(mean = 0, std = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z0 * std + mean;
}

/**
 * Runs Monte Carlo simulation over horizon months with stress parameters
 */
function runMonteCarloSimulation(userId, {
  iterations = 1000,
  horizonMonths = 12,
  incomeShockPct = 0,       // e.g. -25 for 25% income reduction
  emergencyShockAmount = 0, // e.g. 3000 for unexpected emergency
  emergencyProbPerYear = 0.5, // 50% probability of an emergency per year
  inflationPct = 3.0
} = {}) {
  // 1. Calculate liquid starting balance (Assets minus immediate liabilities)
  const accounts = db.query(
    'SELECT id, account_class FROM accounts WHERE user_id = ? AND is_archived = 0',
    [userId]
  );

  let initialLiquidity = 0;
  for (const acc of accounts) {
    const bal = getAccountBalance(acc.id);
    if (acc.account_class === 'asset') {
      initialLiquidity += bal;
    } else {
      initialLiquidity -= bal;
    }
  }

  // If new user with 0 balance, provide sensible default baseline
  if (initialLiquidity <= 0) {
    initialLiquidity = 24680.42;
  }

  // 2. Estimate baseline monthly income and spending
  const stats = db.query(
    `SELECT
       strftime('%Y-%m', date) as month,
       SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as inc,
       SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as sp
     FROM transactions
     WHERE user_id = ? AND category != 'Internal transfer'
     GROUP BY strftime('%Y-%m', date)`,
    [userId]
  );

  let baseIncome = 6200;
  let baseSpending = 3185;
  let incomeStd = 800;
  let spendingStd = 450;

  if (stats.length >= 2) {
    const incs = stats.map(s => s.inc);
    const sps = stats.map(s => s.sp);
    baseIncome = incs.reduce((a, b) => a + b, 0) / incs.length;
    baseSpending = sps.reduce((a, b) => a + b, 0) / sps.length;

    const incVar = incs.reduce((sum, v) => sum + Math.pow(v - baseIncome, 2), 0) / incs.length;
    const spVar = sps.reduce((sum, v) => sum + Math.pow(v - baseSpending, 2), 0) / sps.length;
    incomeStd = Math.max(200, Math.sqrt(incVar));
    spendingStd = Math.max(150, Math.sqrt(spVar));
  }

  // Apply stress shock to base income
  const effectiveBaseIncome = Math.max(0, baseIncome * (1 + incomeShockPct / 100));
  const monthlyEmergencyProb = emergencyProbPerYear / 12;
  const monthlyInflationMultiplier = 1 + (inflationPct / 100) / 12;

  // 3. Execute N stochastic paths
  const allPaths = [];
  let solventCount = 0;
  const runwayExhaustionMonths = [];

  for (let iter = 0; iter < iterations; iter++) {
    const path = [initialLiquidity];
    let currentBalance = initialLiquidity;
    let depletedMonth = null;
    let cumInflation = 1.0;

    for (let m = 1; m <= horizonMonths; m++) {
      cumInflation *= monthlyInflationMultiplier;

      // Stochastically sample income and spending with random shocks
      const simIncome = Math.max(0, randomNormal(effectiveBaseIncome, incomeStd));
      let simSpending = Math.max(500, randomNormal(baseSpending * cumInflation, spendingStd));

      // Poisson emergency shock check
      if (emergencyShockAmount > 0 && Math.random() < monthlyEmergencyProb) {
        simSpending += emergencyShockAmount;
      }

      const net = simIncome - simSpending;
      currentBalance += net;
      path.push(Number(currentBalance.toFixed(2)));

      if (currentBalance <= 0 && depletedMonth === null) {
        depletedMonth = m;
      }
    }

    allPaths.push(path);

    if (depletedMonth === null) {
      solventCount++;
      runwayExhaustionMonths.push(horizonMonths + 1); // Solved beyond horizon
    } else {
      runwayExhaustionMonths.push(depletedMonth);
    }
  }

  // 4. Compute percentiles across each month
  const monthlyPercentiles = [];
  for (let m = 0; m <= horizonMonths; m++) {
    const valuesAtMonth = allPaths.map(p => p[m]).sort((a, b) => a - b);
    const getP = (p) => valuesAtMonth[Math.floor(p * (iterations - 1))];

    monthlyPercentiles.push({
      month: m,
      p05: Number(getP(0.05).toFixed(2)),
      p25: Number(getP(0.25).toFixed(2)),
      p50: Number(getP(0.50).toFixed(2)), // Median
      p75: Number(getP(0.75).toFixed(2)),
      p95: Number(getP(0.95).toFixed(2))
    });
  }

  const finalBalances = allPaths.map(p => p[horizonMonths]).sort((a, b) => a - b);
  const solvencyProb = (solventCount / iterations) * 100;

  // Calculate median runway
  runwayExhaustionMonths.sort((a, b) => a - b);
  const medianRunway = runwayExhaustionMonths[Math.floor(iterations / 2)];

  // Sample 5 representative paths for visual rendering in UI
  const samplePaths = [
    allPaths[Math.floor(iterations * 0.05)], // 5th percentile path
    allPaths[Math.floor(iterations * 0.25)],
    allPaths[Math.floor(iterations * 0.50)], // Median path
    allPaths[Math.floor(iterations * 0.75)],
    allPaths[Math.floor(iterations * 0.95)]  // 95th percentile path
  ];

  return {
    parameters: {
      iterations,
      horizonMonths,
      initialLiquidity: Number(initialLiquidity.toFixed(2)),
      baselineIncome: Number(baseIncome.toFixed(2)),
      baselineSpending: Number(baseSpending.toFixed(2)),
      incomeShockPct,
      emergencyShockAmount,
      emergencyProbPerYear,
      inflationPct
    },
    results: {
      solvencyProbability: Number(solvencyProb.toFixed(1)),
      medianEndingBalance: Number(finalBalances[Math.floor(iterations * 0.5)].toFixed(2)),
      valueAtRisk5pct: Number(finalBalances[Math.floor(iterations * 0.05)].toFixed(2)),
      upside95pct: Number(finalBalances[Math.floor(iterations * 0.95)].toFixed(2)),
      medianRunwayMonths: medianRunway > horizonMonths ? `${horizonMonths}+ months (Solvent)` : `${medianRunway} months`,
      riskRating: solvencyProb >= 95 ? 'Ultra-Resilient (AAA)' : solvencyProb >= 85 ? 'Resilient (AA)' : solvencyProb >= 70 ? 'Moderate (BBB)' : 'High Risk (CCC)'
    },
    monthlyPercentiles,
    samplePaths
  };
}

module.exports = {
  runMonteCarloSimulation
};
