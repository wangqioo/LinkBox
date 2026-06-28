import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initLocalAgentSchema } from '../utils/localAgentSchema.js';
import { deriveItemMaturity, getMaturityCoverage } from '../utils/itemMaturity.js';
import {
  generateLocalAgentReport,
  getLocalAgentStatus,
} from '../utils/localAgentFactory.js';

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

function seedItem(db, fields = {}) {
  const result = db.prepare(`
    INSERT INTO links (user_id, type, title, summary, content, content_md, description, status, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.userId || 1,
    fields.type || 'link',
    fields.title || 'Example item',
    fields.summary || '',
    fields.content || '',
    fields.contentMd || '',
    fields.description || '',
    fields.status || '',
    fields.importedAt || '2026-06-26T00:00:00.000Z',
  );
  return result.lastInsertRowid;
}

test('deriveItemMaturity reports raw converted indexed understood summarized and review states', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  const rawId = seedItem(db);
  const summarizedId = seedItem(db, { contentMd: '# Body', summary: 'Useful summary' });
  const documentId = db.prepare('INSERT INTO documents (item_id, user_id) VALUES (?, 1)').run(summarizedId).lastInsertRowid;
  db.prepare('INSERT INTO document_chunks (document_id, chunk_index, content) VALUES (?, 0, ?)').run(documentId, 'Body chunk');
  db.prepare('INSERT INTO item_understanding_runs (item_id, user_id) VALUES (?, 1)').run(summarizedId);
  db.prepare("INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json) VALUES (1, ?, 'topic_suggestion', 'pending', '{}')").run(summarizedId);

  assert.equal(deriveItemMaturity(db, rawId).state, 'raw');
  const maturity = deriveItemMaturity(db, summarizedId);
  assert.equal(maturity.state, 'review_needed');
  assert.deepEqual(maturity.flags, {
    hasContent: true,
    hasDocument: true,
    hasChunks: true,
    hasUnderstanding: true,
    hasSummary: true,
    hasPendingSuggestion: true,
    hasFailedJob: false,
  });
}));

test('getMaturityCoverage counts states for a user library', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  seedItem(db);
  const convertedId = seedItem(db, { contentMd: 'Converted markdown' });
  const documentId = db.prepare('INSERT INTO documents (item_id, user_id) VALUES (?, 1)').run(convertedId).lastInsertRowid;
  db.prepare('INSERT INTO document_chunks (document_id, chunk_index, content) VALUES (?, 0, ?)').run(documentId, 'Chunk');

  const coverage = getMaturityCoverage(db, { userId: 1 });
  assert.equal(coverage.total, 2);
  assert.equal(coverage.states.raw, 1);
  assert.equal(coverage.states.indexed, 1);
  assert.equal(coverage.reviewNeeded, 0);
}));

test('generateLocalAgentReport records a local factory run and report', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  seedItem(db, { contentMd: 'Ready article', summary: 'Summary' });
  db.prepare("INSERT INTO jobs (type, link_id, status, last_error) VALUES ('image.describe', 1, 'failed', 'empty output')").run();

  const report = generateLocalAgentReport(db, { userId: 1 });

  assert.equal(report.reportType, 'daily');
  assert.equal(report.content.library.total, 1);
  assert.equal(report.content.jobs.failed, 1);
  assert.equal(report.content.headline.includes('本地 Agent'), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_reports').get().count, 1);
  assert.equal(db.prepare('SELECT status FROM agent_runs ORDER BY id DESC LIMIT 1').get().status, 'completed');
}));

test('getLocalAgentStatus returns coverage latest report suggestions and rules', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  seedItem(db);
  generateLocalAgentReport(db, { userId: 1 });

  const status = getLocalAgentStatus(db, { userId: 1 });

  assert.equal(status.coverage.total, 1);
  assert.equal(status.latestReport.reportType, 'daily');
  assert.deepEqual(status.suggestions, []);
  assert.deepEqual(status.rules, []);
}));
