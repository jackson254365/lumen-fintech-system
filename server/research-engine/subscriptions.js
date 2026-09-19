// ============================================================================
// Computational Finance: Subscription & Recurring Bill Detection Engine
// Identifies periodic outlays, calculates annual burn, and projects upcoming renewal dates
// ============================================================================
const db = require('../db');

function detectSubscriptions(userId) {
  // Fetch spending transactions
  const rows = db.query(
    `SELECT name, category, amount, date
     FROM transactions
     WHERE user_id = ? AND amount < 0 AND category != 'Internal transfer'
     ORDER BY date ASC`,
    [userId]
  );

  // Group by normalized payee name
  const grouped = {};
  for (const r of rows) {
    // Simplify name: strip digits, random codes
    const norm = r.name.toLowerCase()
      .replace(/\s+(inc|llc|ltd|corp|\.com)\b/g, '')
      .replace(/[^a-z\s]/g, '')
      .trim();

    if (!norm) continue;

    if (!grouped[norm]) {
      grouped[norm] = {
        displayName: r.name,
        category: r.category,
        occurrences: []
      };
    }
    grouped[norm].occurrences.push({
      amount: Math.abs(r.amount),
      date: new Date(r.date.split(',')[0].includes('Today') ? new Date().toISOString().substring(0, 10) : r.date)
    });
  }

  const detected = [];

  for (const [normKey, data] of Object.entries(grouped)) {
    const occs = data.occurrences;
    if (occs.length < 1) continue;

    const amounts = occs.map(o => o.amount);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;

    // Check if known subscription keywords
    const isKnownSub = /netflix|spotify|apple|disney|prime|hulu|hbo|gym|fitness|insurance|electric|broadband|patreon|icloud|google storage|chatgpt|adobe|github/i.test(data.displayName);

    let cadence = 'Monthly';
    let isRecurring = isKnownSub;

    if (occs.length >= 2) {
      // Calculate interval between successive occurrences
      const intervals = [];
      for (let i = 1; i < occs.length; i++) {
        const diffDays = Math.abs((occs[i].date - occs[i - 1].date) / (1000 * 60 * 60 * 24));
        if (!isNaN(diffDays) && diffDays > 0) {
          intervals.push(diffDays);
        }
      }

      if (intervals.length > 0) {
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (avgInterval >= 25 && avgInterval <= 35) {
          cadence = 'Monthly';
          isRecurring = true;
        } else if (avgInterval >= 6 && avgInterval <= 9) {
          cadence = 'Weekly';
          isRecurring = true;
        } else if (avgInterval >= 350 && avgInterval <= 380) {
          cadence = 'Annual';
          isRecurring = true;
        }
      }
    }

    if (isRecurring) {
      const multiplier = cadence === 'Weekly' ? 52 : cadence === 'Monthly' ? 12 : 1;
      const annualCost = avgAmount * multiplier;
      const monthlyCost = annualCost / 12;

      // Project next billing date (~30 days after latest)
      const lastDate = occs[occs.length - 1].date;
      const nextBilling = new Date(lastDate);
      if (cadence === 'Weekly') nextBilling.setDate(nextBilling.getDate() + 7);
      else if (cadence === 'Annual') nextBilling.setFullYear(nextBilling.getFullYear() + 1);
      else nextBilling.setDate(nextBilling.getDate() + 30);

      detected.push({
        name: data.displayName,
        category: data.category,
        cadence,
        averageAmount: Number(avgAmount.toFixed(2)),
        monthlyBurn: Number(monthlyCost.toFixed(2)),
        annualBurn: Number(annualCost.toFixed(2)),
        nextExpectedCharge: isNaN(nextBilling.getTime()) ? 'Next month' : nextBilling.toISOString().substring(0, 10)
      });
    }
  }

  // Sort by annual burn descending
  detected.sort((a, b) => b.annualBurn - a.annualBurn);

  const totalMonthlyBurn = detected.reduce((sum, s) => sum + s.monthlyBurn, 0);
  const totalAnnualBurn = detected.reduce((sum, s) => sum + s.annualBurn, 0);

  return {
    subscriptions: detected,
    summary: {
      activeCount: detected.length,
      totalMonthlyBurn: Number(totalMonthlyBurn.toFixed(2)),
      totalAnnualBurn: Number(totalAnnualBurn.toFixed(2))
    }
  };
}

module.exports = {
  detectSubscriptions
};
