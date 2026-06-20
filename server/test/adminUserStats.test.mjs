import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_ITEM_TYPE_KEYS,
  emptyAdminTypeStats,
  summarizeAdminItemRows,
} from '../utils/adminUserStats.js';

test('emptyAdminTypeStats exposes normalized admin type buckets', () => {
  assert.deepEqual(ADMIN_ITEM_TYPE_KEYS, ['link', 'article', 'video', 'text', 'image', 'audio', 'document']);
  assert.deepEqual(emptyAdminTypeStats(), {
    link: 0,
    article: 0,
    video: 0,
    text: 0,
    image: 0,
    audio: 0,
    document: 0,
  });
});

test('summarizeAdminItemRows counts display item kinds instead of stored raw types', () => {
  const stats = summarizeAdminItemRows([
    { type: 'link', url: 'https://b23.tv/abc123', status: 'processing', imported_at: '2026-06-20T10:00:00.000Z' },
    { type: 'link', url: 'https://mp.weixin.qq.com/s/abc', status: 'done', imported_at: '2026-06-21T10:00:00.000Z' },
    { type: 'link', url: 'https://example.com/plain', status: 'error', imported_at: '2026-06-19T10:00:00.000Z' },
    { type: 'file', url: '', status: 'done', imported_at: '2026-06-18T10:00:00.000Z' },
    { type: 'image', url: '', status: 'done', imported_at: '2026-06-17T10:00:00.000Z' },
  ]);

  assert.equal(stats.item_count, 5);
  assert.equal(stats.processing_count, 1);
  assert.equal(stats.error_count, 1);
  assert.equal(stats.last_used_at, '2026-06-21T10:00:00.000Z');
  assert.deepEqual(stats.by_type, {
    link: 1,
    article: 1,
    video: 1,
    text: 0,
    image: 1,
    audio: 0,
    document: 1,
  });
});
