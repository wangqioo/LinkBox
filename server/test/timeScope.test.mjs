import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimeScope } from '../utils/timeScope.js';

const now = new Date('2026-06-12T10:00:00+08:00');

test('resolveTimeScope parses yesterday relative to Asia Shanghai dates', () => {
  assert.deepEqual(
    resolveTimeScope({ question: '总结昨天保存的资料', now }),
    { dateFrom: '2026-06-11', dateTo: '2026-06-11' },
  );
});

test('resolveTimeScope parses recent day windows inclusively', () => {
  assert.deepEqual(
    resolveTimeScope({ question: '最近三天的资料有什么重点', now }),
    { dateFrom: '2026-06-10', dateTo: '2026-06-12' },
  );
});

test('resolveTimeScope parses Chinese month and day in current year', () => {
  assert.deepEqual(
    resolveTimeScope({ question: '6月10号保存了什么资料', now }),
    { dateFrom: '2026-06-10', dateTo: '2026-06-10' },
  );
});

test('resolveTimeScope keeps explicit scope date over inferred text', () => {
  assert.deepEqual(
    resolveTimeScope({ question: '昨天的资料', scope: { date: '2026-06-08' }, now }),
    { dateFrom: '2026-06-08', dateTo: '2026-06-08' },
  );
});
