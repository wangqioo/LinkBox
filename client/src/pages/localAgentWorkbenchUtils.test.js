import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionSeverityLabel,
  autopilotSummary,
  formatJobCounts,
  maturityPercent,
  maturityRows,
  ruleActionSummary,
  suggestionEvidenceSummary,
  suggestionActionLabel,
  timelineEventLabel,
} from './localAgentWorkbenchUtils.ts';

test('maturityPercent calculates rounded coverage percentage', () => {
  assert.equal(maturityPercent(3, 10), 30);
  assert.equal(maturityPercent(0, 0), 0);
});

test('maturityRows returns stable local Agent state labels', () => {
  const rows = maturityRows({
    raw: 1,
    converted: 2,
    indexed: 3,
    understood: 4,
    summarized: 5,
    review_needed: 6,
    reviewed: 7,
  });

  assert.deepEqual(rows.map(row => row.key), [
    'raw',
    'converted',
    'indexed',
    'understood',
    'summarized',
    'review_needed',
    'reviewed',
  ]);
  assert.equal(rows.at(-1).label, '已确认');
});

test('suggestionActionLabel maps suggestion types to user-facing commands', () => {
  assert.equal(suggestionActionLabel('topic_suggestion'), '主题建议');
  assert.equal(suggestionActionLabel('unknown'), 'Agent 建议');
});

test('timelineEventLabel maps autopilot event types to compact labels', () => {
  assert.equal(timelineEventLabel('autopilot.job_queued'), '已排队');
  assert.equal(timelineEventLabel('autopilot.failed_jobs_retried'), '已重试');
  assert.equal(timelineEventLabel('unknown'), 'Agent 事件');
});

test('autopilotSummary describes latest completed run actions', () => {
  const summary = autopilotSummary({
    lastRun: {
      status: 'completed',
      summary: {
        actions: {
          enqueued: [{ jobType: 'link.summarize' }, { jobType: 'image.describe' }],
          retriedFailedJobs: 1,
          suggestionsCreated: 3,
        },
      },
    },
  });

  assert.equal(summary, '上次运行：排队 2 个任务，重试 1 个失败任务，生成 3 条建议');
  assert.equal(autopilotSummary(null), '尚未运行 Autopilot');
});

test('actionSeverityLabel maps action severity to concise labels', () => {
  assert.deepEqual(actionSeverityLabel('high'), { label: '优先', tone: 'red' });
  assert.deepEqual(actionSeverityLabel('medium'), { label: '建议', tone: 'amber' });
  assert.deepEqual(actionSeverityLabel('low'), { label: '可选', tone: 'gray' });
});

test('suggestionEvidenceSummary prefers topic and item evidence', () => {
  assert.equal(
    suggestionEvidenceSummary({ topic: 'AI Agent', itemTitle: 'Agent note' }),
    'Agent note · AI Agent',
  );
  assert.equal(suggestionEvidenceSummary({}), '暂无证据摘要');
});

test('ruleActionSummary describes topic preference actions', () => {
  assert.equal(ruleActionSummary({ topic: 'AI Agent' }), '归入主题：AI Agent');
  assert.equal(ruleActionSummary({}), '本地整理规则');
});

test('formatJobCounts summarizes active queue blockers', () => {
  assert.equal(formatJobCounts({ queued: 2, running: 1, done: 4, failed: 3 }), '3 失败 · 2 排队 · 1 运行');
  assert.equal(formatJobCounts({ queued: 0, running: 0, done: 4, failed: 0 }), '队列空闲');
});
