import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runMigrations } from '../utils/dbMigrations.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-db-migrations-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
}

function createLegacyLinksTable(db) {
  db.exec(`
    CREATE TABLE links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      url TEXT DEFAULT '',
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      imported_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

test('runMigrations adds missing item columns to legacy links tables', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.applied, 1);
  assert.deepEqual(result.names, ['001_links_item_columns']);
  assert.deepEqual(columnNames(db, 'links'), [
    'id',
    'user_id',
    'url',
    'title',
    'description',
    'thumbnail',
    'comment',
    'imported_at',
    'created_at',
    'type',
    'content',
    'image_path',
    'summary',
    'html_note',
    'content_md',
    'status',
  ]);
  const row = db.prepare(`
    SELECT name FROM schema_migrations WHERE name = '001_links_item_columns'
  `).get();
  assert.equal(row.name, '001_links_item_columns');
}));

test('runMigrations is idempotent once migrations are recorded', () => withDb((db) => {
  createLegacyLinksTable(db);

  const first = runMigrations(db);
  const second = runMigrations(db);

  assert.equal(first.applied, 1);
  assert.equal(second.applied, 0);
  assert.deepEqual(second.names, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 1);
}));
