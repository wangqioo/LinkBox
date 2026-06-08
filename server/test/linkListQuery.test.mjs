import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLinkListQuery } from '../utils/linkListQuery.js';

test('buildLinkListQuery creates default paginated query scoped to user', () => {
  const query = buildLinkListQuery({ userId: 7, query: {} });

  assert.match(query.sql, /FROM links l WHERE l\.user_id = \? ORDER BY l\.imported_at DESC LIMIT \? OFFSET \?/);
  assert.match(query.countSql, /COUNT\(DISTINCT l\.id\).*FROM links l WHERE l\.user_id = \?/s);
  assert.deepEqual(query.params, [7, 50, 0]);
  assert.deepEqual(query.countParams, [7]);
  assert.equal(query.page, 1);
  assert.equal(query.limit, 50);
});

test('buildLinkListQuery applies filters and separates count params from pagination', () => {
  const query = buildLinkListQuery({
    userId: 9,
    query: {
      tag: '3',
      type: 'file',
      search: 'AI',
      from: '2026-01-01',
      to: '2026-01-31',
      page: '3',
      limit: '20',
    },
  });

  assert.match(query.sql, /JOIN link_tags lt ON l\.id = lt\.link_id JOIN tags t ON lt\.tag_id = t\.id/);
  assert.match(query.sql, /t\.id = \?/);
  assert.match(query.sql, /l\.type = \?/);
  assert.match(query.sql, /l\.title LIKE \? OR l\.url LIKE \? OR l\.comment LIKE \? OR l\.content LIKE \?/);
  assert.match(query.sql, /l\.imported_at >= \?/);
  assert.match(query.sql, /l\.imported_at <= \?/);
  assert.deepEqual(query.countParams, [
    9,
    '3',
    'file',
    '%AI%',
    '%AI%',
    '%AI%',
    '%AI%',
    '2026-01-01',
    '2026-01-31 23:59:59',
  ]);
  assert.deepEqual(query.params, [...query.countParams, 20, 40]);
});

test('buildLinkListQuery clamps invalid pagination values', () => {
  const query = buildLinkListQuery({
    userId: 2,
    query: { page: '0', limit: '-1' },
  });

  assert.equal(query.page, 1);
  assert.equal(query.limit, 50);
  assert.deepEqual(query.params, [2, 50, 0]);
});
