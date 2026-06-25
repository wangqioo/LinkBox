import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRetrievalConfidence } from '../utils/assistantRetrievalConfidence.js';

test('assessRetrievalConfidence marks empty retrieval as insufficient', () => {
  const result = assessRetrievalConfidence({
    question: '部署风险是什么',
    sources: [],
    attempts: [{ question: '部署风险是什么', sourceCount: 0 }],
  });

  assert.equal(result.level, 'insufficient');
  assert.equal(result.score, 0);
  assert.equal(result.shouldCorrect, true);
  assert.ok(result.reasons.includes('no_sources'));
});

test('assessRetrievalConfidence detects weak single-source evidence', () => {
  const result = assessRetrievalConfidence({
    question: '部署 风险 端口 缓存',
    sources: [
      {
        id: 1,
        title: '泛泛记录',
        source_index: 1,
        retrieval_modes: ['recent'],
        score: 0.05,
        chunk_text: '这里有一些部署相关背景。',
      },
    ],
    attempts: [{ question: '部署 风险 端口 缓存', sourceCount: 1 }],
  });

  assert.equal(result.level, 'low');
  assert.equal(result.shouldCorrect, true);
  assert.ok(result.reasons.includes('single_source'));
  assert.ok(result.reasons.includes('low_query_coverage'));
});

test('assessRetrievalConfidence accepts diverse supported evidence', () => {
  const result = assessRetrievalConfidence({
    question: '部署 风险 端口 缓存',
    sources: [
      {
        id: 1,
        title: '部署记录',
        source_index: 1,
        sourceKind: 'document',
        retrieval_modes: ['keyword', 'embedding'],
        score: 0.8,
        chunk_text: '部署风险包括端口冲突和缓存失效。',
      },
      {
        id: 2,
        title: '上线复盘',
        source_index: 2,
        sourceKind: 'structured_knowledge',
        retrieval_modes: ['structured'],
        score: 0.4,
        chunk_text: '待办：上线前检查端口和缓存。',
      },
    ],
    attempts: [{ question: '部署 风险 端口 缓存', sourceCount: 2 }],
  });

  assert.equal(result.level, 'high');
  assert.equal(result.shouldCorrect, false);
  assert.ok(result.score >= 70);
  assert.ok(result.signals.modeDiversity >= 3);
});
