import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as markdownParser from './markdownParser.ts';

const { parseBlocks } = markdownParser;

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

test('parseBlocks treats unsafe raw HTML as text instead of executable markup', () => {
  const blocks = parseBlocks(`<script>alert("x")</script>
<img src=x onerror="alert('x')">`);

  assert.deepEqual(blocks, [
    {
      kind: 'paragraph',
      lines: [
        '<script>alert("x")</script>',
        '<img src=x onerror="alert(\'x\')">',
      ],
    },
  ]);
});

test('normalizeCitations expands bounded ranges and repairs open citations', () => {
  assert.equal(
    markdownParser.normalizeCitations('结论见[资料2 - 4]和[资料7'),
    '结论见[资料2][资料3][资料4]和[资料7]',
  );
});
