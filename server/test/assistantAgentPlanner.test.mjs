import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planAssistantTurn,
  summarizeRetrievalPlan,
} from '../utils/assistantAgentPlanner.js';

test('planAssistantTurn classifies task and question into an observable retrieval plan', () => {
  const plan = planAssistantTurn({
    question: '总结最近一周 Bilibili 视频里提到的部署风险',
    task: 'recent',
    scope: { type: 'video' },
    groupId: 0,
  });

  assert.equal(plan.intent, 'recent_summary');
  assert.equal(plan.needsAnswer, true);
  assert.deepEqual(plan.scope, { type: 'video' });
  assert.ok(plan.tools.some(tool => tool.name === 'recent'));
  assert.ok(plan.tools.some(tool => tool.name === 'keyword'));
  assert.ok(plan.tools.some(tool => tool.name === 'vector'));
  assert.match(summarizeRetrievalPlan(plan), /recent/);
});

test('planAssistantTurn chooses group retrieval for group scoped questions', () => {
  const plan = planAssistantTurn({
    question: '群里 Launch 项目的下一步待办是什么',
    task: 'todos',
    groupId: 10,
  });

  assert.equal(plan.intent, 'todo_extraction');
  assert.equal(plan.scopeType, 'group');
  assert.ok(plan.tools.some(tool => tool.name === 'group_context'));
  assert.ok(plan.rewriteQueries.includes('Launch 项目的下一步待办是什么'));
});

test('planAssistantTurn creates sub questions for broad project status questions', () => {
  const plan = planAssistantTurn({
    question: 'LinkBox Agent 现在还差什么，下一步怎么做',
    task: 'ask',
  });

  assert.equal(plan.intent, 'question_answering');
  assert.ok(plan.subQuestions.includes('LinkBox Agent 已经完成了哪些能力？'));
  assert.ok(plan.subQuestions.includes('LinkBox Agent 现在还缺哪些能力或决策？'));
  assert.ok(plan.subQuestions.includes('LinkBox Agent 下一步最应该做什么？'));
  assert.ok(plan.rewriteQueries.includes('LinkBox Agent 已经完成了哪些能力？'));
});

test('planAssistantTurn exposes latest item lookup for newest upload questions', () => {
  const plan = planAssistantTurn({
    question: '我最新发的文件是啥',
    task: 'ask',
  });

  assert.equal(plan.intent, 'question_answering');
  assert.ok(plan.tools.some(tool => tool.name === 'latest_item'));
  assert.match(summarizeRetrievalPlan(plan), /latest_item/);
});

test('planAssistantTurn treats empty questions as insufficient input', () => {
  const plan = planAssistantTurn({ question: '   ', task: 'ask' });

  assert.equal(plan.intent, 'insufficient_input');
  assert.equal(plan.needsAnswer, false);
  assert.deepEqual(plan.tools, []);
});
