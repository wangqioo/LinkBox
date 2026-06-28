import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  maturityPercent,
  maturityRows,
  suggestionActionLabel,
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
