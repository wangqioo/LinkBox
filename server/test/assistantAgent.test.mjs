import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { completeAssistantAgentAnswer, prepareAssistantAgentTurn } from '../utils/assistantAgent.js';
import { initAssistantRunSchema } from '../utils/assistantRuns.js';
import { captureAssistantMemories, initAssistantMemorySchema } from '../utils/assistantMemory.js';

function setupDb() {
  const db = new Database(':memory:');
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
    CREATE TABLE assistant_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'alice', 'x')").run();
  db.prepare('INSERT INTO assistant_conversations (id, user_id) VALUES (5, 1)').run();
  initAssistantRunSchema(db);
  initAssistantMemorySchema(db);
  return db;
}

test('prepareAssistantAgentTurn plans retrieval builds evidence and records run steps', async () => {
  const db = setupDb();
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 5,
    question: '部署风险是什么',
    task: 'ask',
    retrieve: async ({ question }) => ({
      ranked: [
        {
          id: 42,
          title: '部署记录',
          source_index: 1,
          sourceKind: 'document',
          retrieval_modes: ['keyword'],
          chunk_text: `${question}：需要检查端口和缓存。`,
        },
      ],
      embeddingConfig: { enabled: false, provider: 'local', model: 'local' },
    }),
  });

  assert.equal(turn.plan.intent, 'question_answering');
  assert.equal(turn.ranked.length, 1);
  assert.equal(turn.evidence.status, 'ready');
  assert.equal(turn.verification.support, 'supported');
  assert.equal(turn.agent.run.status, 'completed');
  assert.deepEqual(turn.agent.run.steps.map(step => step.step_type), [
    'plan',
    'memory',
    'retrieval',
    'evidence',
  ]);

  db.close();
});

test('prepareAssistantAgentTurn records insufficient evidence when retrieval is empty', async () => {
  const db = setupDb();
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 5,
    question: '不存在的资料',
    task: 'ask',
    retrieve: async () => ({
      ranked: [],
      embeddingConfig: { enabled: false },
    }),
  });

  assert.equal(turn.evidence.status, 'empty');
  assert.equal(turn.verification.support, 'insufficient');
  assert.equal(turn.agent.run.status, 'completed');

  db.close();
});

test('prepareAssistantAgentTurn retries retrieval with rewrite queries', async () => {
  const db = setupDb();
  const attemptedQuestions = [];
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 5,
    question: '群里 交付 风险',
    task: 'ask',
    retrieve: async ({ question }) => {
      attemptedQuestions.push(question);
      if (question === '交付 风险') {
        return {
          ranked: [
            {
              id: 99,
              title: '交付记录',
              source_index: 1,
              sourceKind: 'group_message',
              retrieval_modes: ['keyword'],
              content: '交付风险集中在测试环境和账号权限。',
            },
          ],
          embeddingConfig: { enabled: false },
        };
      }
      return {
        ranked: [],
        embeddingConfig: { enabled: false },
      };
    },
  });

  assert.deepEqual(attemptedQuestions, ['群里 交付 风险', '交付 风险']);
  assert.equal(turn.ranked.length, 1);
  assert.equal(turn.evidence.status, 'ready');
  assert.equal(turn.agent.run.steps.find(step => step.step_type === 'retrieval').metadata.queryCount, 2);

  db.close();
});

test('completeAssistantAgentAnswer records citation verification on the run', async () => {
  const db = setupDb();
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 5,
    question: '部署风险是什么',
    task: 'ask',
    retrieve: async () => ({
      ranked: [
        {
          id: 42,
          title: '部署记录',
          source_index: 1,
          sourceKind: 'document',
          retrieval_modes: ['keyword'],
          chunk_text: '需要检查端口和缓存。',
        },
      ],
      embeddingConfig: { enabled: false },
    }),
  });

  const completed = completeAssistantAgentAnswer({
    db,
    agentTurn: turn,
    answer: '需要检查端口和缓存。[资料2]',
    sourceCount: 1,
  });

  assert.equal(completed.verification.support, 'partial');
  assert.deepEqual(completed.verification.citations.invalid, [2]);
  assert.deepEqual(completed.agent.run.steps.map(step => step.step_type), [
    'plan',
    'memory',
    'retrieval',
    'evidence',
    'answer_verification',
  ]);
  assert.equal(completed.agent.run.verification.support, 'partial');

  db.close();
});

test('prepareAssistantAgentTurn includes matching assistant memories as diagnostics', async () => {
  const db = setupDb();
  captureAssistantMemories(db, {
    userId: 1,
    text: '记住：回答部署问题时先列风险。',
  });

  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 5,
    question: '部署风险是什么',
    task: 'ask',
    retrieve: async () => ({
      ranked: [],
      embeddingConfig: { enabled: false },
    }),
  });

  assert.equal(turn.memory.items.length, 1);
  assert.match(turn.memory.items[0].content, /先列风险/);
  assert.equal(turn.agent.run.steps.find(step => step.step_type === 'memory').metadata.memoryCount, 1);

  db.close();
});
