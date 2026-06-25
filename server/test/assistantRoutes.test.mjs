import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function withAssistantApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-assistant-routes-test-'));
  const dbPath = join(dir, 'test.db');
  const oldDbPath = process.env.DB_PATH;
  const oldDataDir = process.env.DATA_DIR;
  const oldUploadsDir = process.env.UPLOADS_DIR;
  process.env.DB_PATH = dbPath;
  process.env.DATA_DIR = dir;
  process.env.UPLOADS_DIR = join(dir, 'uploads');

  let db;
  let server;
  try {
    const token = `${Date.now()}-${Math.random()}`;
    const dbModule = await import(`../db.js?assistant-routes-test=${token}`);
    db = dbModule.default;
    db.prepare(`
      INSERT INTO users (id, username, password_hash)
      VALUES (1, 'admin', 'hash')
      ON CONFLICT(id) DO NOTHING
    `).run();
    const assistantModule = await import(`../routes/assistant.js?assistant-routes-test=${token}`);

    const app = express();
    app.use(express.json());
    app.use('/api/assistant', assistantModule.createAssistantRouter(db));

    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.on('error', reject);
    });

    return await fn({
      db,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      headers: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
      },
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close();
    process.env.DB_PATH = oldDbPath;
    process.env.DATA_DIR = oldDataDir;
    process.env.UPLOADS_DIR = oldUploadsDir;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('assistant route uses centralized JSON error helpers', () => {
  const routeSource = readFileSync(join(__dirname, '../routes/assistant.js'), 'utf8');

  assert.match(routeSource, /jsonError/);
  assert.doesNotMatch(routeSource, /res\.status\([^)]*\)\.json\(\{\s*error:/);
});

test('assistant route preserves validation and conversation error responses', async () => withAssistantApp(async ({ baseUrl, headers }) => {
  const missingQuestion = await fetch(`${baseUrl}/api/assistant/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question: '' }),
  });
  assert.equal(missingQuestion.status, 400);
  assert.deepEqual(await missingQuestion.json(), { error: '问题不能为空' });

  const missingConversation = await fetch(`${baseUrl}/api/assistant/conversations/999/messages`, {
    headers,
  });
  assert.equal(missingConversation.status, 404);
  assert.deepEqual(await missingConversation.json(), { error: 'Conversation not found' });
}));

test('POST /api/assistant/retrieval-diagnostics returns retrieval metadata without calling LLM', async () => withAssistantApp(async ({ db, baseUrl, headers }) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 1, 'file', 'Queue Notes', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Queue Notes

## Durable Jobs

Durable queue retry metadata.`);

  const response = await fetch(`${baseUrl}/api/assistant/retrieval-diagnostics`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      question: 'durable queue retry',
      task: 'ask',
      scope: { type: 'document' },
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.query, 'durable queue retry');
  assert.equal(body.task, 'ask');
  assert.deepEqual(body.scope, { type: 'document' });
  assert.equal(body.settings.enabled, true);
  assert.equal(body.sources[0].sourceKind, 'document');
  assert.equal(body.sources[0].id, 1);
  assert.equal(body.sources[0].heading_path, 'Queue Notes > Durable Jobs');
  assert.equal(body.sources[0].retrieval_modes.includes('keyword'), true);
  assert.match(body.sources[0].snippet, /Durable queue retry metadata/);
  assert.equal(body.agent.plan.intent, 'question_answering');
  assert.equal(body.agent.evidence.status, 'ready');
  assert.equal(body.agent.verification.support, 'supported');
  assert.equal(body.agent.run.status, 'completed');
  assert.equal(body.agent.run.steps.find(step => step.step_type === 'retrieval').metadata.queryCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_runs').get().count, 1);
}));

test('POST /api/assistant/chat returns agent metadata when evidence is empty', async () => withAssistantApp(async ({ db, baseUrl, headers }) => {
  const response = await fetch(`${baseUrl}/api/assistant/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      question: '记住：回答 launch 问题时先列风险',
      task: 'ask',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.sources.length, 0);
  assert.equal(body.agent.plan.intent, 'question_answering');
  assert.equal(body.agent.evidence.status, 'empty');
  assert.equal(body.agent.verification.support, 'insufficient');
  assert.equal(body.agent.memory.items.length, 1);
  assert.match(body.agent.memory.items[0].content, /先列风险/);
  assert.equal(body.agent.run.status, 'completed');
  assert.equal(body.agent.run.steps.some(step => step.step_type === 'answer_verification'), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_runs').get().count, 1);
}));

test('assistant conversation endpoints create, list, read, and delete personal history', async () => withAssistantApp(async ({ db, baseUrl, headers }) => {
  const create = await fetch(`${baseUrl}/api/assistant/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Launch research' }),
  });
  const created = await create.json();
  assert.equal(create.status, 201);
  assert.equal(created.conversation.title, 'Launch research');
  assert.equal(created.conversation.scope_type, 'personal');
  assert.equal(created.conversation.group_id, null);

  db.prepare(`
    INSERT INTO assistant_messages (conversation_id, role, content, task, sources_json)
    VALUES (?, 'user', 'What changed?', 'ask', '[]')
  `).run(created.conversation.id);
  db.prepare(`
    INSERT INTO assistant_messages (conversation_id, role, content, task, sources_json)
    VALUES (?, 'assistant', 'The group agent changed.', 'ask', ?)
  `).run(created.conversation.id, JSON.stringify([{ id: 1, title: 'Source' }]));

  const list = await fetch(`${baseUrl}/api/assistant/conversations`, { headers });
  const listed = await list.json();
  assert.equal(list.status, 200);
  assert.equal(listed.conversations.length, 1);
  assert.equal(listed.conversations[0].message_count, 2);

  const messages = await fetch(`${baseUrl}/api/assistant/conversations/${created.conversation.id}/messages`, { headers });
  const history = await messages.json();
  assert.equal(messages.status, 200);
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[1].role, 'assistant');
  assert.deepEqual(history.messages[1].sources, [{ id: 1, title: 'Source' }]);

  const deleted = await fetch(`${baseUrl}/api/assistant/conversations/${created.conversation.id}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(deleted.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_conversations').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_messages').get().count, 0);
}));

test('assistant memory endpoints list and delete scoped memories', async () => withAssistantApp(async ({ db, baseUrl, headers }) => {
  db.prepare(`
    INSERT INTO assistant_memories (id, user_id, scope_type, group_id, memory_type, content, source)
    VALUES (1, 1, 'personal', NULL, 'preference', '回答时先给结论', 'explicit')
  `).run();

  const list = await fetch(`${baseUrl}/api/assistant/memories`, { headers });
  const listed = await list.json();
  assert.equal(list.status, 200);
  assert.equal(listed.memories.length, 1);
  assert.equal(listed.memories[0].content, '回答时先给结论');

  const deleted = await fetch(`${baseUrl}/api/assistant/memories/1`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { ok: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_memories').get().count, 0);
}));

test('assistant conversations are separated by personal and group scope', async () => withAssistantApp(async ({ db, baseUrl, headers }) => {
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (2, 'member', 'hash')").run();
  db.prepare("INSERT INTO groups (id, name, owner_id) VALUES (10, 'Launch', 1)").run();
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (10, 1, 'owner')").run();

  const personal = await fetch(`${baseUrl}/api/assistant/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Personal' }),
  }).then(response => response.json());
  const group = await fetch(`${baseUrl}/api/assistant/conversations?groupId=10`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Group' }),
  }).then(response => response.json());

  assert.equal(personal.conversation.scope_type, 'personal');
  assert.equal(group.conversation.scope_type, 'group');
  assert.equal(group.conversation.group_id, 10);

  const personalList = await fetch(`${baseUrl}/api/assistant/conversations`, { headers }).then(response => response.json());
  const groupList = await fetch(`${baseUrl}/api/assistant/conversations?groupId=10`, { headers }).then(response => response.json());
  assert.deepEqual(personalList.conversations.map(item => item.title), ['Personal']);
  assert.deepEqual(groupList.conversations.map(item => item.title), ['Group']);

  const wrongScope = await fetch(`${baseUrl}/api/assistant/conversations/${group.conversation.id}/messages`, { headers });
  assert.equal(wrongScope.status, 404);
}));
