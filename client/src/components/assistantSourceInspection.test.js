import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assistantSourceInspectionRows,
  formatAssistantHeadingPath,
  formatAssistantScore,
} from './assistantSourceInspection.ts';

test('assistantSourceInspectionRows formats retrieval metadata as user-facing rows', () => {
  assert.deepEqual(assistantSourceInspectionRows({
    sourceKind: 'document',
    retrieval_modes: ['keyword', 'embedding'],
    heading_path: ['Queue Notes', 'Durable Jobs'],
    score: 12.34567,
    combined_score: 0.8754,
    embedding_score: 0.7654,
    rerank_mode: 'local',
    rerank_score: 0.6543,
    chunk_type: 'section',
  }), [
    { label: '来源', value: 'document' },
    { label: '命中', value: 'keyword + embedding' },
    { label: '章节', value: 'Queue Notes > Durable Jobs' },
    { label: '分数', value: '12.346' },
    { label: '综合', value: '0.875' },
    { label: '语义', value: '0.765' },
    { label: '重排', value: 'local 0.654' },
    { label: '切块', value: 'section' },
  ]);
});

test('assistant source inspection helpers ignore absent values', () => {
  assert.deepEqual(assistantSourceInspectionRows(null), []);
  assert.deepEqual(assistantSourceInspectionRows({ sourceKind: 'legacy', score: Number.NaN }), [
    { label: '来源', value: 'legacy' },
  ]);
  assert.equal(formatAssistantScore(0.12345), '0.123');
  assert.equal(formatAssistantScore('0.123'), '');
  assert.equal(formatAssistantHeadingPath('Plan > Intro'), 'Plan > Intro');
  assert.equal(formatAssistantHeadingPath(['Plan', '', 'Intro']), 'Plan > Intro');
});
