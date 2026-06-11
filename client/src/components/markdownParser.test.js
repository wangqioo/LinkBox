import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBlocks } from './markdownParser.ts';

test('parseBlocks preserves ordered-list start numbers when paragraphs split a list', () => {
  const blocks = parseBlocks(`1. 第一条

说明文字

2. 第二条

补充说明

3. 第三条`);

  assert.deepEqual(blocks, [
    { kind: 'ol', start: 1, items: ['第一条'] },
    { kind: 'paragraph', lines: ['说明文字'] },
    { kind: 'ol', start: 2, items: ['第二条'] },
    { kind: 'paragraph', lines: ['补充说明'] },
    { kind: 'ol', start: 3, items: ['第三条'] },
  ]);
});

test('parseBlocks treats blank-separated ordered markers as one loose list', () => {
  const blocks = parseBlocks(`1. 第一条

1. 第二条

1. 第三条`);

  assert.deepEqual(blocks, [
    { kind: 'ol', start: 1, items: ['第一条', '第二条', '第三条'] },
  ]);
});
