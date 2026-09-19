// ============================================================================
// End-to-End REST API Integration & Idempotency Tests
// ============================================================================
const assert = require('assert');
const app = require('../server/index');

console.log('🧪 Running tests/api.test.js...');

const server = app.listen(0, async () => {
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/api/system/health`);
    const healthJson = await healthRes.json();
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthJson.status, 'healthy');
    console.log('  ✓ GET /api/system/health responded with healthy status');

    // 2. Fetch accounts
    const accRes = await fetch(`${baseUrl}/api/accounts`);
    const accJson = await accRes.json();
    assert.strictEqual(accRes.status, 200);
    assert.ok(accJson.accounts.length >= 1);
    console.log(`  ✓ GET /api/accounts returned ${accJson.accounts.length} accounts with live balances`);

    // 3. Cryptographic Audit Check via API
    const auditRes = await fetch(`${baseUrl}/api/ledger/verify-audit`);
    const auditJson = await auditRes.json();
    assert.strictEqual(auditRes.status, 200);
    assert.strictEqual(auditJson.audit.valid, true);
    assert.strictEqual(auditJson.audit.tamperDetected, false);
    console.log(`  ✓ GET /api/ledger/verify-audit verified cryptographic block integrity`);

    // 4. Research Forecast
    const forecastRes = await fetch(`${baseUrl}/api/research/forecast`);
    const forecastJson = await forecastRes.json();
    assert.strictEqual(forecastRes.status, 200);
    assert.ok(forecastJson.forecast.projected.length === 6);
    console.log('  ✓ GET /api/research/forecast returned 6-month Holt-Winters projections');

    // 5. Research Health Score
    const healthScoreRes = await fetch(`${baseUrl}/api/research/health-score`);
    const healthScoreJson = await healthScoreRes.json();
    assert.strictEqual(healthScoreRes.status, 200);
    assert.ok(healthScoreJson.health.score >= 0);
    console.log(`  ✓ GET /api/research/health-score returned score: ${healthScoreJson.health.score}/100`);

    // 6. Idempotency Key test
    const idempotencyKey = 'test_key_' + Date.now();
    const payload = JSON.stringify({
      accountId: accJson.accounts[0].id,
      amount: 10.00,
      type: 'spending',
      description: 'Idempotent Coffee Test'
    });

    // First request
    const post1 = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: payload
    });
    const json1 = await post1.json();
    assert.strictEqual(post1.status, 201);
    const txId1 = json1.transaction.transactionId;

    // Second request with SAME idempotency key (must NOT duplicate transaction!)
    const post2 = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: payload
    });
    const json2 = await post2.json();
    assert.strictEqual(post2.headers.get('x-cache-lookup'), 'HIT-IDEMPOTENT');
    assert.strictEqual(json2.transaction.transactionId, txId1);
    console.log('  ✓ Idempotency-Key successfully prevented double-spending and returned cached response');

    console.log('🎉 tests/api.test.js PASSED!\n');
  } catch (err) {
    console.error('Test error:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
