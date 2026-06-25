import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initAssistantRunSchema, startAssistantRun, recordAssistantRunStep, finishAssistantRun, getAssistantRun } from '../utils/assistantRuns.js';

test('assistantRuns records a planned agent run and ordered steps', () => {
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
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (7, 'agent-user', 'x')").run();
  db.prepare('INSERT INTO assistant_conversations (id, user_id) VALUES (11, 7)').run();
  initAssistantRunSchema(db);

  const run = startAssistantRun(db, {
    userId: 7,
    conversationId: 11,
    groupId: 0,
    question: '部署风险是什么',
    task: 'ask',
    plan: { intent: 'question_answering', tools: [{ name: 'keyword' }] },
  });
  recordAssistantRunStep(db, {
    runId: run.id,
    stepType: 'plan',
    label: 'Plan retrieval',
    status: 'done',
    metadata: { tools: ['keyword'] },
  });
  recordAssistantRunStep(db, {
    runId: run.id,
    stepType: 'evidence',
    label: 'Build evidence notebook',
    status: 'done',
    metadata: { count: 1 },
  });
  finishAssistantRun(db, {
    runId: run.id,
    status: 'completed',
    evidence: { status: 'ready', items: [{ citation: '[资料1]' }] },
    verification: { support: 'supported' },
  });

  const saved = getAssistantRun(db, run.id);
  assert.equal(saved.id, run.id);
  assert.equal(saved.intent, 'question_answering');
  assert.equal(saved.status, 'completed');
  assert.deepEqual(saved.plan.tools, [{ name: 'keyword' }]);
  assert.equal(saved.evidence.items[0].citation, '[资料1]');
  assert.deepEqual(saved.verification, { support: 'supported' });
  assert.deepEqual(saved.steps.map(step => [step.step_index, step.step_type, step.label]), [
    [1, 'plan', 'Plan retrieval'],
    [2, 'evidence', 'Build evidence notebook'],
  ]);
  assert.match(saved.completed_at, /^\d{4}-\d{2}-\d{2}/);

  db.close();
});
