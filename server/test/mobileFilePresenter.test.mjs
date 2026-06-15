import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMobileStatus,
  normalizeMobileType,
  parseMobileFileSize,
  toMobileFile,
} from '../utils/mobileFilePresenter.js';

test('normalizeMobileType maps stored file items to mobile documents', () => {
  assert.equal(normalizeMobileType({ type: 'file' }), 'document');
  assert.equal(normalizeMobileType({ type: 'link' }), 'link');
  assert.equal(normalizeMobileType({}), 'link');
});

test('normalizeMobileStatus prefers durable processing state', () => {
  assert.equal(normalizeMobileStatus({ status: 'done' }), 'ready');
  assert.equal(normalizeMobileStatus({ status: 'processing' }), 'pending');
  assert.equal(normalizeMobileStatus({ status: 'done', processing: { state: 'queued' } }), 'pending');
  assert.equal(normalizeMobileStatus({ status: 'done', processing: { state: 'running' } }), 'pending');
  assert.equal(normalizeMobileStatus({ status: 'done', processing: { state: 'failed' } }), 'failed');
});

test('toMobileFile carries processing details and last error for clients', () => {
  const file = toMobileFile({
    id: 12,
    type: 'file',
    title: 'report.pdf',
    description: 'report.pdf (2 KB)',
    imported_at: '2026-06-10T00:00:00.000Z',
    processing: {
      state: 'failed',
      lastError: 'pdftotext missing',
    },
  });

  assert.equal(file.id, '12');
  assert.equal(file.type, 'document');
  assert.equal(file.status, 'failed');
  assert.equal(file.error, 'pdftotext missing');
  assert.equal(file.processing.state, 'failed');
});

test('toMobileFile sources type and retry state from shared presentation', () => {
  const result = toMobileFile({
    id: 9,
    type: 'file',
    title: 'Plan.pdf',
    image_path: '/uploads/plan.pdf',
    status: 'done',
    processing: { state: 'failed', canRetry: true, lastError: 'parse failed' },
  });

  assert.equal(result.type, 'document');
  assert.equal(result.status, 'failed');
  assert.equal(result.can_retry, true);
  assert.equal(result.url, '/uploads/plan.pdf');
});

test('toMobileFile exposes image batch metadata', () => {
  const result = toMobileFile({
    id: 10,
    type: 'image',
    title: 'A.jpg',
    image_path: '/uploads/a.jpg',
    batch_id: 'batch-1',
    batch_index: 2,
  });

  assert.equal(result.batch_id, 'batch-1');
  assert.equal(result.batch_index, 2);
});

test('parseMobileFileSize extracts byte sizes from upload descriptions', () => {
  assert.equal(parseMobileFileSize({ description: 'report.pdf (2 KB)' }), 2048);
  assert.equal(parseMobileFileSize({ description: 'deck.pptx (1.5 MB)' }), 1572864);
  assert.equal(parseMobileFileSize({ description: 'plain note' }), null);
});
