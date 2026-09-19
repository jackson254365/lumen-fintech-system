// ============================================================================
// Database Adapter using Node.js 22 built-in node:sqlite
// Configured with Write-Ahead Logging (WAL) and strict foreign keys for ACID safety
// ============================================================================
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    const dbDir = path.dirname(config.DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new DatabaseSync(config.DB_PATH);

    // Apply high-performance, robust ACID pragmas
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA synchronous = NORMAL;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');

    initSchema(dbInstance);
  }
  return dbInstance;
}

function initSchema(db) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
}

// Wrapper utilities
function query(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

function get(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

function run(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

function exec(sql) {
  const db = getDb();
  return db.exec(sql);
}

let transactionDepth = 0;

// Transaction helper supporting arbitrary nesting via SQLite SAVEPOINT
function transaction(fn) {
  const db = getDb();
  const currentDepth = transactionDepth;
  if (currentDepth === 0) {
    db.exec('BEGIN TRANSACTION;');
  } else {
    db.exec(`SAVEPOINT sp_${currentDepth};`);
  }
  transactionDepth++;

  try {
    const result = fn();
    transactionDepth--;
    if (currentDepth === 0) {
      db.exec('COMMIT;');
    } else {
      db.exec(`RELEASE SAVEPOINT sp_${currentDepth};`);
    }
    return result;
  } catch (err) {
    transactionDepth--;
    if (currentDepth === 0) {
      db.exec('ROLLBACK;');
    } else {
      db.exec(`ROLLBACK TO SAVEPOINT sp_${currentDepth};`);
    }
    throw err;
  }
}

module.exports = {
  getDb,
  query,
  get,
  run,
  exec,
  transaction
};
