import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initLocalAgentSchema } from '../utils/localAgentSchema.js';

function withDb(fn) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'link',
        url TEXT DEFAULT '',
        title TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        content TEXT DEFAULT '',
        content_md TEXT DEFAULT '',
        description TEXT DEFAULT '',
        status TEXT DEFAULT '',
        imported_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO users (id, username, password_hash) VALUES (1, 'admin', 'hash');
    `);
    return fn(db);
  } finally {
    db.close();
  }
}

test('initLocalAgentSchema creates local Agent factory tables', () => withDb((db) => {
  initLocalAgentSchema(db);

  const tables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('agent_runs', 'agent_reports', 'agent_suggestions', 'agent_rules', 'item_maturity_events')
    ORDER BY name
  `).all().map(row => row.name);

  assert.deepEqual(tables, [
    'agent_reports',
    'agent_rules',
    'agent_runs',
    'agent_suggestions',
    'item_maturity_events',
  ]);
}));
