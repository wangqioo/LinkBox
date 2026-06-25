import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidenceNotebook,
  evidenceSupportStatus,
} from '../utils/assistantEvidence.js';

test('buildEvidenceNotebook turns ranked sources into cited evidence cards', () => {
  const notebook = buildEvidenceNotebook([
    {
      id: 42,
      title: '部署记录',
      url: 'https://example.com/deploy',
      source_index: 1,
      sourceKind: 'document',
      retrieval_modes: ['keyword', 'embedding'],
      score: 8.5,
      heading_path: '部署 > 风险',
      chunk_text: 'GPU 机器部署时需要检查模型缓存和端口。',
      imported_at: '2026-06-24T00:00:00.000Z',
    },
  ]);

  assert.equal(notebook.status, 'ready');
  assert.equal(notebook.items.length, 1);
  assert.deepEqual(notebook.items[0], {
    citation: '[资料1]',
    sourceId: 42,
    title: '部署记录',
    url: 'https://example.com/deploy',
    sourceKind: 'document',
    retrievalModes: ['keyword', 'embedding'],
    score: 8.5,
    headingPath: '部署 > 风险',
    snippet: 'GPU 机器部署时需要检查模型缓存和端口。',
    importedAt: '2026-06-24T00:00:00.000Z',
    supportReason: 'matched by keyword, embedding in 部署 > 风险',
  });
  assert.equal(evidenceSupportStatus(notebook), 'supported');
});

test('buildEvidenceNotebook reports empty evidence as insufficient', () => {
  const notebook = buildEvidenceNotebook([]);

  assert.equal(notebook.status, 'empty');
  assert.deepEqual(notebook.items, []);
  assert.equal(evidenceSupportStatus(notebook), 'insufficient');
});
