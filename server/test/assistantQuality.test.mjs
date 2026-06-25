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
      CREATE TABLE group_members (
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (group_id, user_id)
      );
      CREATE TABLE group_links (
        group_id INTEGER NOT NULL,
        link_id INTEGER NOT NULL,
        shared_by INTEGER NOT NULL,
        note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (group_id, link_id)
      );
      CREATE TABLE group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'text',
        created_at TEXT DEFAULT (datetime('now'))
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
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'alice', 'x'), (2, 'bob', 'x')").run();
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
  return ({ question, task, scope, groupId }) => ({
    ranked: retrieveSources({
      db,
      userId: 1,
      groupId,
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

test('assistant quality: group scoped retrieval uses shared materials without personal leakage', () => withQualityDb(async (db) => {
  db.prepare("INSERT INTO groups (id, name, owner_id) VALUES (10, 'Launch Team', 1)").run();
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (10, 1, 'owner'), (10, 2, 'member')").run();
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES
      (5, 2, 'file', 'Shared Launch Runbook', '2026-06-25T12:00:00.000Z', ?),
      (6, 1, 'file', 'Private Launch Payroll', '2026-06-25T13:00:00.000Z', ?)
  `).run(
    '# Shared Launch Runbook\n\n## Roadmap\n\nlaunch roadmap depends on qa signoff',
    '# Private Launch Payroll\n\n## Roadmap\n\nlaunch roadmap payroll numbers are private',
  );
  db.prepare("INSERT INTO group_links (group_id, link_id, shared_by, note) VALUES (10, 5, 2, 'shared for launch')").run();
  db.prepare("INSERT INTO group_messages (group_id, user_id, body) VALUES (10, 2, 'launch roadmap needs qa signoff')").run();

  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 1,
    groupId: 10,
    question: 'launch roadmap',
    task: 'ask',
    retrieve: retrieveFromDb(db),
  });

  assert.equal(turn.ranked.some(source => source.id === 5), true);
  assert.equal(turn.ranked.some(source => source.id === 6), false);
  assert.equal(turn.ranked.some(source => source.id === 'group-message:1'), true);
  assert.equal(turn.evidence.status, 'ready');
}));

test('assistant quality: weak single-source evidence is not treated as fully supported', () => withQualityDb(async (db) => {
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 1,
    question: 'Agent 部署 风险 端口 缓存',
    task: 'ask',
    retrieve: async () => ({
      ranked: [
        {
          id: 7,
          title: '弱相关记录',
          source_index: 1,
          sourceKind: 'document',
          retrieval_modes: ['recent'],
          score: 0.05,
          chunk_text: 'Agent 部署有一些背景。',
        },
      ],
      embeddingConfig: { enabled: false },
    }),
  });

  assert.equal(turn.retrievalConfidence.level, 'low');
  assert.equal(turn.verification.support, 'partial');
  assert.ok(turn.verification.issues.includes('low_retrieval_confidence'));
}));

test('assistant quality: low confidence retrieval can recover through corrective query', () => withQualityDb(async (db) => {
  const attempted = [];
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 1,
    question: '群里 Agent 部署 风险 端口 缓存',
    task: 'ask',
    retrieve: async ({ question }) => {
      attempted.push(question);
      if (question.startsWith('群里')) {
        return {
          ranked: [
            {
              id: 8,
              title: '弱群消息',
              source_index: 1,
              sourceKind: 'group_message',
              retrieval_modes: ['recent'],
              score: 0.05,
              content: '群里讨论过 Agent 部署。',
            },
          ],
          embeddingConfig: { enabled: false },
        };
      }
      return {
        ranked: [
          {
            id: 9,
            title: 'Agent 部署复盘',
            source_index: 1,
            sourceKind: 'document',
            retrieval_modes: ['keyword', 'structured'],
            score: 0.8,
            chunk_text: 'Agent 部署风险包括端口冲突和缓存失效，需要上线前检查端口和缓存。',
          },
          {
            id: 10,
            title: 'Agent 上线待办',
            source_index: 2,
            sourceKind: 'structured_knowledge',
            retrieval_modes: ['structured'],
            score: 0.6,
            chunk_text: '待办：上线前检查 Agent 端口和缓存。',
          },
        ],
        embeddingConfig: { enabled: false },
      };
    },
  });

  assert.deepEqual(attempted, ['群里 Agent 部署 风险 端口 缓存', 'Agent 部署 风险 端口 缓存']);
  assert.equal(turn.ranked[0].id, 9);
  assert.equal(turn.retrievalConfidence.level, 'high');
  assert.equal(turn.verification.support, 'supported');
}));

test('assistant quality: broad agent planning questions expose sub-question diagnostics', () => withQualityDb(async (db) => {
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 1,
    question: 'LinkBox Agent 现在还差什么，下一步怎么做',
    task: 'ask',
    retrieve: async () => ({
      ranked: [
        {
          id: 11,
          title: 'Agent Roadmap',
          source_index: 1,
          sourceKind: 'document',
          retrieval_modes: ['keyword', 'structured'],
          score: 0.7,
          chunk_text: 'LinkBox Agent 已完成 planner、retrieval confidence 和 verification。下一步是质量评测。',
        },
      ],
      embeddingConfig: { enabled: false },
    }),
  });

  assert.ok(turn.plan.subQuestions.includes('LinkBox Agent 已经完成了哪些能力？'));
  assert.ok(turn.plan.rewriteQueries.includes('LinkBox Agent 下一步最应该做什么？'));
  assert.equal(turn.agent.run.plan.subQuestions.length, 3);
}));

test('assistant quality: broad agent questions gather evidence across sub-questions', () => withQualityDb(async (db) => {
  const attempted = [];
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 1,
    question: 'LinkBox Agent 现在还差什么，下一步怎么做',
    task: 'ask',
    retrieve: async ({ question }) => {
      attempted.push(question);
      const notes = {
        'LinkBox Agent 已经完成了哪些能力？': {
          id: 20,
          title: 'Agent Done',
          chunk_text: 'LinkBox Agent 已完成 planner、evidence notebook、retrieval confidence 和 citation verification。',
        },
        'LinkBox Agent 现在还缺哪些能力或决策？': {
          id: 21,
          title: 'Agent Gaps',
          chunk_text: 'LinkBox Agent 还缺自动回答质量回归、长期记忆治理和真实失败样本沉淀。',
        },
        'LinkBox Agent 下一步最应该做什么？': {
          id: 22,
          title: 'Agent Next',
          chunk_text: 'LinkBox Agent 下一步应该让子问题检索结果约束最终回答，并持续扩充质量 fixtures。',
        },
      };
      const note = notes[question] || notes['LinkBox Agent 已经完成了哪些能力？'];
      return {
        ranked: [
          {
            ...note,
            source_index: 1,
            sourceKind: 'document',
            retrieval_modes: ['keyword', 'structured'],
            score: 0.8,
          },
        ],
        embeddingConfig: { enabled: false },
      };
    },
  });

  assert.equal(attempted.length, 4);
  assert.deepEqual(turn.ranked.map(source => source.id), [20, 21, 22]);
  assert.equal(turn.evidence.items.length, 3);
  assert.equal(turn.verification.support, 'supported');
}));
