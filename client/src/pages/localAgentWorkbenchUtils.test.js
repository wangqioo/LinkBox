import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  autopilotSummary,
  maturityPercent,
  maturityRows,
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
