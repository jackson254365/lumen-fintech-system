// ============================================================================
// Auth & Workspace Preferences Routes
// ============================================================================
const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

router.get('/me', (req, res) => {
  const user = db.get(
    'SELECT id, name, email, currency, api_key, settings_json, created_at FROM users WHERE id = ?',
    [req.user.id]
  );

  let settings = {};
  try {
    settings = JSON.parse(user.settings_json || '{}');
  } catch (e) {}

  res.json({
    success: true,
    user: {
      ...user,
      initials: user.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase(),
      settings
    }
  });
});

router.post('/api-key', (req, res) => {
  const newApiKey = 'lumen_live_sk_' + crypto.randomBytes(16).toString('hex');
  db.run('UPDATE users SET api_key = ? WHERE id = ?', [newApiKey, req.user.id]);

  res.json({
    success: true,
    apiKey: newApiKey,
    message: 'New API Key generated successfully'
  });
});

router.patch('/profile', (req, res) => {
  const { name, currency, settings } = req.body;
  const updates = [];
  const params = [];

  if (name && name.trim()) {
    updates.push('name = ?');
    params.push(name.trim());
  }
  if (currency && currency.trim()) {
    updates.push('currency = ?');
    params.push(currency.trim().toUpperCase());
  }
  if (settings && typeof settings === 'object') {
    updates.push('settings_json = ?');
    params.push(JSON.stringify(settings));
  }

  if (updates.length > 0) {
    params.push(req.user.id);
    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  const updated = db.get('SELECT id, name, email, currency, api_key, settings_json FROM users WHERE id = ?', [req.user.id]);
  res.json({
    success: true,
    user: {
      ...updated,
      initials: updated.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase(),
      settings: JSON.parse(updated.settings_json || '{}')
    }
  });
});

module.exports = router;
