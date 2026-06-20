import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMobileFilesListQuery, buildMobileFilesSearchQuery } from '../utils/mobileFilesQuery.js';

test('buildMobileFilesListQuery maps normalized mobile item types to stored rows', () => {
  const video = buildMobileFilesListQuery({ userId: 7, query: { type: 'video', limit: '25', offset: '5' } });
  assert.match(video.sql, /type = 'link'/);
  assert.match(video.sql, /bilibili\.com\/video\/BV/);
  assert.match(video.sql, /b23\.tv/);
  assert.deepEqual(video.params, [7, 25, 5]);

  const article = buildMobileFilesListQuery({ userId: 7, query: { type: 'article' } });
  assert.match(article.sql, /mp\.weixin\.qq\.com/);
  assert.match(article.sql, /zhihu\.com\/p/);
  assert.deepEqual(article.params, [7, 500, 0]);

  const document = buildMobileFilesListQuery({ userId: 7, query: { type: 'document' } });
  assert.match(document.sql, /type = \?/);
  assert.deepEqual(document.params, [7, 'file', 500, 0]);
});

test('buildMobileFilesSearchQuery applies date, normalized type, and text search', () => {
  const query = buildMobileFilesSearchQuery({
    userId: 9,
    query: {
      q: '汉堡',
      date: '2026-06-20',
      type: 'video',
    },
  });

  assert.match(query.sql, /substr\(imported_at, 1, 10\) = \?/);
  assert.match(query.sql, /type = 'link'/);
  assert.match(query.sql, /b23\.tv/);
  assert.match(query.sql, /title LIKE \? OR url LIKE \? OR description LIKE \? OR content LIKE \? OR content_md LIKE \? OR summary LIKE \?/);
  assert.deepEqual(query.params, [9, '2026-06-20', '%汉堡%', '%汉堡%', '%汉堡%', '%汉堡%', '%汉堡%', '%汉堡%']);
});
