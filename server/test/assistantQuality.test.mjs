import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { prepareAssistantAgentTurn } from '../utils/assistantAgent.js';
import { captureAssistantMemories, initAssistantMemorySchema } from '../utils/assistantMemory.js';
import { initAssistantRunSchema } from '../utils/assistantRuns.js';
import { retrieveSources } from '../utils/assistantRetrieval.js';
import { initDocumentSchema, indexDocumentForItem } from '../utils/documentIndex.js';
import { upsertItemUnderstanding } from '../utils/itemUnderstanding.js';

async function withQualityDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-assistant-quality-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        owner_id INTEGER NOT NULL
      );
      CREATE TABLE links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'link',
        url TEXT DEFAULT '',
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        thumbnail TEXT DEFAULT '',
        comment TEXT DEFAULT '',
        content TEXT DEFAULT '',
        image_path TEXT DEFAULT '',
        imported_at TEXT DEFAULT '',
        created_at TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        status TEXT DEFAULT '',
        content_md TEXT DEFAULT '',
        html_note TEXT DEFAULT ''
      );
      CREATE TABLE link_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE TABLE assistant_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL
      );
    `);
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'alice', 'x')").run();
    db.prepare('INSERT INTO assistant_conversations (id, user_id) VALUES (1, 1)').run();
    initDocumentSchema(db);
    initAssistantRunSchema(db);
    initAssistantMemorySchema(db);
    return await fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function retrieveFromDb(db) {
  return ({ question, task, scope }) => ({
    ranked: retrieveSources({
      db,
      userId: 1,
      question,
      task,
      scope,
      maxSources: 4,
      enableEmbeddings: false,
      enableRerank: true,
      includeLegacyFallback: false,
    }),
    embeddingConfig: { enabled: false, provider: 'local', model: 'local' },
  });
}

test('assistant quality: canonical document queries return the intended source with ready evidence', () => withQualityDb(async (db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 1, 'file', 'LinkBox Agent Design', '2026-06-25T08:00:00.000Z', ?)
  `).run(`# LinkBox Agent Design

## Retrieval Contract

The assistant must cite canonical Markdown chunks before answering project architecture questions.`);
  indexDocumentForItem(db, 1);

  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 1,
    question: 'retrieval contract architecture',
    task: 'ask',
    retrieve: retrieveFromDb(db),
  });

  assert.equal(turn.ranked[0].id, 1);
  assert.ok(turn.ranked[0].document_id);
  assert.ok(turn.ranked[0].chunk_id);
  assert.equal(turn.evidence.status, 'ready');
  assert.equal(turn.verification.support, 'supported');
  assert.match(turn.evidence.items[0].snippet, /canonical Markdown chunks/);
}));

test('assistant quality: structured understanding supplies todos when documents are not indexed', () => withQualityDb(async (db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, comment, imported_at, content_md)
    VALUES (2, 1, 'file', 'Agent Roadmap', 'TODO: add mobile diagnostics', '2026-06-25T09:00:00.000Z', '')
  `).run();
  upsertItemUnderstanding(db, 2);

  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 1,
    question: 'mobile diagnostics',
    task: 'todos',
    retrieve: retrieveFromDb(db),
  });

  assert.equal(turn.ranked[0].id, 2);
  assert.equal(turn.ranked[0].sourceKind, 'structured_knowledge');
  assert.equal(turn.ranked[0].retrieval_modes.includes('structured'), true);
  assert.equal(turn.evidence.status, 'ready');
}));

test('assistant quality: explicit memories are loaded without becoming evidence', () => withQualityDb(async (db) => {
  captureAssistantMemories(db, {
    userId: 1,
    text: '记住：回答架构问题时先说明数据流。',
  });
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (3, 1, 'file', 'Architecture Note', '2026-06-25T10:00:00.000Z', ?)
  `).run('# Architecture Note\n\n## Data Flow\n\nRequests go through planner, retrieval, evidence and verification.');
  indexDocumentForItem(db, 3);

  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 1,
    question: '架构 data flow',
    task: 'ask',
    retrieve: retrieveFromDb(db),
  });

  assert.equal(turn.memory.items.length, 1);
  assert.match(turn.memory.items[0].content, /数据流/);
  assert.equal(turn.ranked[0].id, 3);
  assert.equal(turn.evidence.items.some(item => item.title === 'Architecture Note'), true);
}));

test('assistant quality: unrelated questions stay insufficient instead of using stale fallback', () => withQualityDb(async (db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (4, 1, 'file', 'Deployment Note', '2026-06-25T11:00:00.000Z', ?)
  `).run('# Deployment Note\n\n## Ports\n\nThe local service uses port 5173 during development.');
  indexDocumentForItem(db, 4);

  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 1,
    question: 'quantum banana nebula',
    task: 'ask',
    retrieve: retrieveFromDb(db),
  });

  assert.equal(turn.ranked.length, 0);
  assert.equal(turn.evidence.status, 'empty');
  assert.equal(turn.verification.support, 'insufficient');
}));
