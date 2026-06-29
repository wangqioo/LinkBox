import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { generateToken } from '../middleware/auth.js';
import { createSettingsRouter } from '../routes/settings.js';
import { createJobQueue } from '../utils/jobQueue.js';
import { initLocalAgentSchema } from '../utils/localAgentSchema.js';

function createApp() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, password_hash TEXT NOT NULL);
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
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '');
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE item_topics (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, weight REAL DEFAULT 1);
    INSERT INTO users (id, username, password_hash) VALUES (1, 'admin', 'hash'), (2, 'user', 'hash');
    INSERT INTO links (id, user_id, title, content_md, summary) VALUES (1, 1, 'Agent note', 'Markdown body', 'Summary');
  `);
  initLocalAgentSchema(db);
  const queue = createJobQueue({ db, autoStart: false });
  const app = express();
  app.use(express.json());
  app.use('/api/settings', createSettingsRouter({
    database: db,
    getQueue: () => queue,
    uploadsDir: '/tmp/uploads',
  }));
  return { app, db, queue };
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

test('GET /api/settings/local-agent returns local factory status for admin', async () => {
  const { app, db } = createApp();
  const server = await listen(app);
  try {
    db.prepare(`
      INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json)
      VALUES (1, 1, 'topic_suggestion', 'pending', ?)
    `).run(JSON.stringify({ topic: 'AI Agent' }));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/local-agent`, {
      headers: { Authorization: `Bearer ${generateToken(1)}` },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.coverage.total, 1);
    assert.equal(body.suggestions.length, 1);
    assert.equal(body.jobs.counts.failed, 0);
    assert.equal(Array.isArray(body.jobs.failed), true);
    assert.equal(Array.isArray(body.nextActions), true);
    assert.equal(Array.isArray(body.runs), true);
    assert.equal(body.suggestions[0].itemTitle, 'Agent note');
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('POST /api/settings/local-agent/report creates a local factory report', async () => {
  const { app, db } = createApp();
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/local-agent/report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reportType: 'daily' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.report.reportType, 'daily');
    assert.equal(body.status.latestReport.reportType, 'daily');
    assert.equal(Array.isArray(body.status.nextActions), true);
    assert.equal(Array.isArray(body.status.runs), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_reports').get().count, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('POST /api/settings/local-agent/suggestions/:id/resolve accepts a suggestion', async () => {
  const { app, db } = createApp();
  const suggestionId = db.prepare(`
    INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json)
    VALUES (1, 1, 'topic_suggestion', 'pending', ?)
  `).run(JSON.stringify({ topic: 'AI Agent' })).lastInsertRowid;
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/local-agent/suggestions/${suggestionId}/resolve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'accept' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.suggestion.status, 'accepted');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_rules').get().count, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('POST /api/settings/local-agent/autopilot/run runs a bounded scan for admin', async () => {
  const { app, db, queue } = createApp();
  db.prepare("UPDATE links SET type = 'text', summary = '', content_md = 'Needs a local summary' WHERE id = 1").run();
  db.prepare("INSERT INTO item_topics (item_id, user_id, name, weight) VALUES (1, 1, 'Autopilot', 0.93)").run();
  let drainCalled = false;
  const originalDrain = queue.drain;
  queue.drain = () => {
    drainCalled = true;
    originalDrain();
  };
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/local-agent/autopilot/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ retryFailed: true, limits: { maxItems: 10, maxEnqueue: 5 } }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.actions.enqueued.length, 1);
    assert.equal(body.status.autopilot.lastRun.status, 'completed');
    assert.equal(body.status.autopilot.timeline.length > 0, true);
    assert.equal(body.status.suggestions.length, 1);
    assert.equal(drainCalled, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('local Agent endpoints require admin', async () => {
  const { app, db } = createApp();
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/local-agent`, {
      headers: { Authorization: `Bearer ${generateToken(2)}` },
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
