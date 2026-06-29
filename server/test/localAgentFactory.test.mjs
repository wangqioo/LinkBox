import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initLocalAgentSchema } from '../utils/localAgentSchema.js';
import {
  getLocalAgentAutopilotStatus,
  listLocalAgentTimeline,
  runLocalAgentAutopilot,
} from '../utils/localAgentAutopilot.js';
import { deriveItemMaturity, getMaturityCoverage } from '../utils/itemMaturity.js';
import {
  createTopicSuggestions,
  generateLocalAgentReport,
  getLocalAgentStatus,
  resolveLocalAgentSuggestion,
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
        image_path TEXT DEFAULT '',
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
      AND name IN ('agent_runs', 'agent_reports', 'agent_suggestions', 'agent_rules', 'agent_timeline_events', 'item_maturity_events')
    ORDER BY name
  `).all().map(row => row.name);

  assert.deepEqual(tables, [
    'agent_reports',
    'agent_rules',
    'agent_runs',
    'agent_suggestions',
    'agent_timeline_events',
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

test('getLocalAgentStatus returns jobs next actions runs and enriched review context', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      link_id INTEGER,
      status TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      last_error TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    );
  `);
  const itemId = seedItem(db, { title: 'Agent note', type: 'file', contentMd: 'Markdown body' });
  db.prepare(`
    INSERT INTO jobs (type, link_id, status, attempts, max_attempts, last_error, updated_at)
    VALUES ('document.embed', ?, 'failed', 3, 3, 'embedding timeout', '2026-06-29T10:00:00.000Z')
  `).run(itemId);
  const suggestionId = db.prepare(`
    INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json, reason, confidence, evidence_json)
    VALUES (1, ?, 'topic_suggestion', 'pending', ?, 'Topic appears repeatedly', 0.91, ?)
  `).run(
    itemId,
    JSON.stringify({ topic: 'AI Agent', title: '将资料归入主题：AI Agent' }),
    JSON.stringify({ itemTitle: 'Agent note', topic: 'AI Agent' }),
  ).lastInsertRowid;
  db.prepare(`
    INSERT INTO agent_rules (user_id, rule_type, status, title, condition_json, action_json, source_suggestion_id)
    VALUES (1, 'topic_preference', 'active', '主题偏好：AI Agent', ?, ?, ?)
  `).run(
    JSON.stringify({ source: 'accepted_topic_suggestion' }),
    JSON.stringify({ topic: 'AI Agent' }),
    suggestionId,
  );
  generateLocalAgentReport(db, { userId: 1 });

  const status = getLocalAgentStatus(db, { userId: 1 });

  assert.equal(status.jobs.counts.failed, 1);
  assert.equal(status.jobs.failed[0].itemTitle, 'Agent note');
  assert.equal(status.jobs.failed[0].lastError, 'embedding timeout');
  assert.equal(status.nextActions[0].kind, 'retry_failed_jobs');
  assert.equal(status.nextActions[0].severity, 'high');
  assert.equal(status.runs.length, 1);
  assert.equal(status.runs[0].status, 'completed');
  assert.equal(status.suggestions[0].itemTitle, 'Agent note');
  assert.equal(status.suggestions[0].itemType, 'file');
  assert.equal(status.rules[0].sourceSuggestion.id, suggestionId);
  assert.equal(status.rules[0].sourceItemTitle, 'Agent note');
}));

test('getLocalAgentStatus tolerates minimal jobs tables in isolated tests', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
  seedItem(db, { title: 'Minimal job fixture' });
  db.prepare("INSERT INTO jobs (type, status) VALUES ('local.test', 'failed')").run();

  const status = getLocalAgentStatus(db, { userId: 1 });

  assert.equal(status.jobs.counts.failed, 1);
  assert.equal(status.jobs.failed[0].type, 'local.test');
  assert.equal(status.jobs.failed[0].itemId, null);
  assert.equal(status.jobs.failed[0].lastError, '');
}));

test('createTopicSuggestions creates pending suggestions from item topics', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE item_topics (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, weight REAL DEFAULT 1);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  const itemId = seedItem(db, { title: 'Codex Agent note', contentMd: 'Codex can automate local work.' });
  db.prepare("INSERT INTO item_topics (item_id, user_id, name, weight) VALUES (?, 1, 'AI Agent', 0.92)").run(itemId);

  const result = createTopicSuggestions(db, { userId: 1 });

  assert.equal(result.created, 1);
  const suggestion = db.prepare('SELECT * FROM agent_suggestions').get();
  assert.equal(suggestion.suggestion_type, 'topic_suggestion');
  assert.equal(suggestion.status, 'pending');
  assert.equal(JSON.parse(suggestion.proposal_json).topic, 'AI Agent');
}));

test('resolveLocalAgentSuggestion accepts a suggestion and creates an active rule', () => withDb((db) => {
  initLocalAgentSchema(db);
  const itemId = seedItem(db, { title: 'Codex Agent note' });
  const suggestionId = db.prepare(`
    INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json, reason, confidence, evidence_json)
    VALUES (1, ?, 'topic_suggestion', 'pending', ?, 'Topic appears repeatedly', 0.9, ?)
  `).run(
    itemId,
    JSON.stringify({ topic: 'AI Agent', title: '把类似资料归到 AI Agent' }),
    JSON.stringify({ topic: 'AI Agent' }),
  ).lastInsertRowid;

  const result = resolveLocalAgentSuggestion(db, {
    userId: 1,
    suggestionId,
    action: 'accept',
  });

  assert.equal(result.status, 'accepted');
  const rule = db.prepare('SELECT * FROM agent_rules WHERE source_suggestion_id = ?').get(suggestionId);
  assert.equal(rule.status, 'active');
  assert.equal(rule.rule_type, 'topic_preference');
  assert.equal(JSON.parse(rule.action_json).topic, 'AI Agent');
}));

test('resolveLocalAgentSuggestion rejects a suggestion without creating a rule', () => withDb((db) => {
  initLocalAgentSchema(db);
  const suggestionId = db.prepare(`
    INSERT INTO agent_suggestions (user_id, suggestion_type, status, proposal_json)
    VALUES (1, 'topic_suggestion', 'pending', ?)
  `).run(JSON.stringify({ topic: 'Noise' })).lastInsertRowid;

  const result = resolveLocalAgentSuggestion(db, {
    userId: 1,
    suggestionId,
    action: 'reject',
  });

  assert.equal(result.status, 'rejected');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_rules').get().count, 0);
}));

function createQueueSpy() {
  const enqueued = [];
  let retried = 0;
  let drained = 0;
  return {
    enqueued,
    enqueue(type, options) {
      enqueued.push({ type, ...options });
      return { id: enqueued.length, type, link_id: options?.linkId || null };
    },
    retryFailedJobs() {
      retried += 1;
      return 2;
    },
    drain() {
      drained += 1;
    },
    stats() {
      return {
        concurrency: 1,
        running: 0,
        queued: enqueued.length,
        leased: 0,
        done: 0,
        failed: Math.max(0, 2 - retried),
        retried,
        drained,
      };
    },
  };
}

test('runLocalAgentAutopilot enqueues safe missing work and records timeline', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE item_topics (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, weight REAL DEFAULT 1);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, payload TEXT DEFAULT '{}', status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  const linkId = seedItem(db, { type: 'link', title: 'Article needing summary', contentMd: 'Long markdown without summary' });
  const imageId = seedItem(db, { type: 'image', title: 'Screenshot', contentMd: '', summary: '', description: '' });
  db.prepare('UPDATE links SET image_path = ? WHERE id = ?').run('/uploads/screenshot.png', imageId);
  db.prepare("INSERT INTO item_topics (item_id, user_id, name, weight) VALUES (?, 1, 'Local Agent', 0.9)").run(linkId);
  db.prepare("INSERT INTO jobs (type, link_id, status, last_error) VALUES ('link.summarize', ?, 'failed', 'temporary')").run(linkId);
  db.prepare("INSERT INTO jobs (type, link_id, status, last_error) VALUES ('image.describe', ?, 'queued', '')").run(imageId);
  const queue = createQueueSpy();

  const result = runLocalAgentAutopilot(db, {
    userId: 1,
    queue,
    retryFailed: true,
    limits: { maxItems: 20, maxEnqueue: 10, maxSuggestions: 5 },
    uploadsDir: '/var/lib/linkbox/uploads',
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions.retriedFailedJobs, 2);
  assert.deepEqual(queue.enqueued.map(job => job.type), ['link.summarize']);
  assert.equal(result.actions.enqueued.length, 1);
  assert.equal(result.actions.suggestionsCreated, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_reports').get().count, 1);
  const events = listLocalAgentTimeline(db, { userId: 1, limit: 10 });
  assert.equal(events.length >= 4, true);
  assert.equal(events.some(event => event.eventType === 'autopilot.job_queued'), true);
  assert.equal(events.some(event => event.eventType === 'autopilot.failed_jobs_retried'), true);
}));

test('runLocalAgentAutopilot maps uploaded image public paths to disk paths', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, payload TEXT DEFAULT '{}', status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  const imageId = seedItem(db, { type: 'image', title: 'Screenshot' });
  db.prepare('UPDATE links SET image_path = ? WHERE id = ?').run('/uploads/screenshot.png', imageId);
  const queue = createQueueSpy();

  runLocalAgentAutopilot(db, {
    userId: 1,
    queue,
    limits: { maxItems: 20, maxEnqueue: 10 },
    uploadsDir: '/var/lib/linkbox/uploads',
  });

  assert.equal(queue.enqueued.length, 1);
  assert.equal(queue.enqueued[0].type, 'image.describe');
  assert.equal(queue.enqueued[0].payload.diskPath, '/var/lib/linkbox/uploads/screenshot.png');
}));

test('getLocalAgentAutopilotStatus returns the latest run and timeline', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, payload TEXT DEFAULT '{}', status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  seedItem(db, { type: 'text', title: 'Note', contentMd: 'Needs summary' });
  runLocalAgentAutopilot(db, { userId: 1, queue: createQueueSpy() });

  const status = getLocalAgentAutopilotStatus(db, { userId: 1 });

  assert.equal(status.lastRun.status, 'completed');
  assert.equal(status.lastRun.summary.ok, true);
  assert.equal(status.timeline.length > 0, true);
  assert.equal(status.enabled, false);
}));
