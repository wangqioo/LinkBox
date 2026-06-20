import test from 'node:test';
import assert from 'node:assert/strict';
import { presentItem } from '../utils/itemPresentation.js';

test('presentItem maps stored files to document display type', () => {
  const result = presentItem({
    type: 'file',
    title: 'Report.pdf',
    image_path: '/uploads/report.pdf',
    status: 'done',
    processing: { state: 'idle', canRetry: false },
  });

  assert.deepEqual(result.display, {
    type: 'document',
    typeLabel: 'Document',
    status: 'done',
    statusLabel: 'Done',
    canRetry: false,
    canAnalyze: true,
    primaryAssetUrl: '/uploads/report.pdf',
  });
});

test('presentItem prefers durable processing state over legacy status', () => {
  const result = presentItem({
    type: 'link',
    url: 'https://example.com',
    status: 'done',
    processing: { state: 'failed', canRetry: true, lastError: 'parser failed' },
  });

  assert.equal(result.display.status, 'failed');
  assert.equal(result.display.statusLabel, 'Failed');
  assert.equal(result.display.canRetry, true);
});

test('presentItem treats Bilibili links as analyzable video items', () => {
  const result = presentItem({
    type: 'link',
    url: 'https://www.bilibili.com/video/BV1GDjB66EE9/',
    status: 'done',
  });

  assert.equal(result.display.type, 'video');
  assert.equal(result.display.typeLabel, 'Video');
  assert.equal(result.display.canAnalyze, true);
});
