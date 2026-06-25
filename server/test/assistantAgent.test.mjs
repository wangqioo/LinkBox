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

test('prepareAssistantAgentTurn marks weak retrieval confidence as partial support', async () => {
  const db = setupDb();
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 5,
    question: '部署 风险 端口 缓存',
    task: 'ask',
    retrieve: async () => ({
      ranked: [
        {
          id: 71,
          title: '泛泛部署记录',
          source_index: 1,
          sourceKind: 'document',
          retrieval_modes: ['recent'],
          score: 0.05,
          chunk_text: '这里有一些部署相关背景。',
        },
      ],
      embeddingConfig: { enabled: false },
    }),
  });

  const retrievalStep = turn.agent.run.steps.find(step => step.step_type === 'retrieval');
  assert.equal(turn.evidence.status, 'ready');
  assert.equal(turn.verification.support, 'partial');
  assert.equal(turn.verification.retrievalConfidence.level, 'low');
  assert.equal(retrievalStep.metadata.confidence.level, 'low');
  assert.equal(retrievalStep.metadata.confidence.shouldCorrect, true);

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

test('prepareAssistantAgentTurn continues after weak retrieval and keeps stronger corrective evidence', async () => {
  const db = setupDb();
  const attemptedQuestions = [];
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 5,
    question: '群里 部署 风险 端口 缓存',
    task: 'ask',
    retrieve: async ({ question }) => {
      attemptedQuestions.push(question);
      if (question === '群里 部署 风险 端口 缓存') {
        return {
          ranked: [
            {
              id: 1,
              title: '弱相关记录',
              source_index: 1,
              sourceKind: 'group_message',
              retrieval_modes: ['recent'],
              score: 0.05,
              content: '群里提到过部署背景。',
            },
          ],
          embeddingConfig: { enabled: false },
        };
      }
      return {
        ranked: [
          {
            id: 2,
            title: '部署风险复盘',
            source_index: 1,
            sourceKind: 'document',
            retrieval_modes: ['keyword', 'structured'],
            score: 0.8,
            chunk_text: '部署风险包括端口冲突和缓存失效，群里要求上线前检查端口和缓存。',
          },
          {
            id: 3,
            title: '上线待办',
            source_index: 2,
            sourceKind: 'structured_knowledge',
            retrieval_modes: ['structured'],
            score: 0.6,
            chunk_text: '待办：部署前检查端口和缓存。',
          },
        ],
        embeddingConfig: { enabled: false },
      };
    },
  });

  assert.deepEqual(attemptedQuestions, ['群里 部署 风险 端口 缓存', '部署 风险 端口 缓存']);
  assert.deepEqual(turn.ranked.map(source => source.id), [2, 3]);
  assert.equal(turn.retrievalConfidence.level, 'high');
  assert.equal(turn.verification.support, 'supported');
  assert.equal(turn.agent.run.steps.find(step => step.step_type === 'retrieval').metadata.queryCount, 2);

  db.close();
});

test('prepareAssistantAgentTurn gathers bounded sub-question evidence for broad questions', async () => {
  const db = setupDb();
  const attemptedQuestions = [];
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 5,
    question: 'LinkBox Agent 现在还差什么，下一步怎么做',
    task: 'ask',
    retrieve: async ({ question }) => {
      attemptedQuestions.push(question);
      if (question.includes('已经完成')) {
        return {
          ranked: [
            {
              id: 1,
              title: 'Agent 已完成能力',
              source_index: 1,
              sourceKind: 'document',
              retrieval_modes: ['keyword'],
              score: 0.7,
              chunk_text: 'LinkBox Agent 已经完成 planner、retrieval confidence 和 verification。',
            },
          ],
          embeddingConfig: { enabled: false },
        };
      }
      if (question.includes('还缺')) {
        return {
          ranked: [
            {
              id: 2,
              title: 'Agent 待补能力',
              source_index: 1,
              sourceKind: 'document',
              retrieval_modes: ['structured'],
              score: 0.7,
              chunk_text: 'LinkBox Agent 现在还缺答案质量评测和更细的长期记忆策略。',
            },
          ],
          embeddingConfig: { enabled: false },
        };
      }
      if (question.includes('下一步')) {
        return {
          ranked: [
            {
              id: 3,
              title: 'Agent 下一步计划',
              source_index: 1,
              sourceKind: 'document',
              retrieval_modes: ['keyword', 'structured'],
              score: 0.8,
              chunk_text: 'LinkBox Agent 下一步最应该做自动质量回归和回答策略收敛。',
            },
          ],
          embeddingConfig: { enabled: false },
        };
      }
      return {
        ranked: [
          {
            id: 1,
            title: 'Agent 已完成能力',
            source_index: 1,
            sourceKind: 'document',
            retrieval_modes: ['keyword'],
            score: 0.7,
            chunk_text: 'LinkBox Agent 已经完成 planner、retrieval confidence 和 verification。',
          },
        ],
        embeddingConfig: { enabled: false },
      };
    },
  });

  assert.deepEqual(attemptedQuestions, [
    'LinkBox Agent 现在还差什么，下一步怎么做',
    'LinkBox Agent 已经完成了哪些能力？',
    'LinkBox Agent 现在还缺哪些能力或决策？',
    'LinkBox Agent 下一步最应该做什么？',
  ]);
  assert.deepEqual(turn.ranked.map(source => source.id), [1, 2, 3]);
  assert.equal(turn.agent.run.steps.find(step => step.step_type === 'retrieval').metadata.queryCount, 4);
  assert.equal(turn.evidence.items.length, 3);

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

test('completeAssistantAgentAnswer preserves low retrieval confidence in answer verification', async () => {
  const db = setupDb();
  const turn = await prepareAssistantAgentTurn({
    db,
    userId: 1,
    conversationId: 5,
    question: '部署 风险 端口 缓存',
    task: 'ask',
    retrieve: async () => ({
      ranked: [
        {
          id: 71,
          title: '泛泛部署记录',
          source_index: 1,
          sourceKind: 'document',
          retrieval_modes: ['recent'],
          score: 0.05,
          chunk_text: '这里有一些部署相关背景。',
        },
      ],
      embeddingConfig: { enabled: false },
    }),
  });

  const completed = completeAssistantAgentAnswer({
    db,
    agentTurn: turn,
    answer: '资料只提供了部署相关背景，不能确认端口和缓存风险细节。[资料1]',
    sourceCount: 1,
  });

  assert.equal(completed.verification.support, 'partial');
  assert.ok(completed.verification.issues.includes('low_retrieval_confidence'));
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
