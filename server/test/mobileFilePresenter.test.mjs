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

test('parseMobileFileSize extracts byte sizes from upload descriptions', () => {
  assert.equal(parseMobileFileSize({ description: 'report.pdf (2 KB)' }), 2048);
  assert.equal(parseMobileFileSize({ description: 'deck.pptx (1.5 MB)' }), 1572864);
  assert.equal(parseMobileFileSize({ description: 'plain note' }), null);
});
