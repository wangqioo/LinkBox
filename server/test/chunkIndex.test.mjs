import test from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoChunks, tokenizeQuery } from '../utils/chunkIndex.js';

test('splitIntoChunks preserves short paragraphs as one chunk', () => {
  const chunks = splitIntoChunks('第一段\n\n第二段');
  assert.deepEqual(chunks, ['第一段\n\n第二段']);
});

test('splitIntoChunks caps very long content', () => {
  const chunks = splitIntoChunks('x'.repeat(120000));
  assert.equal(chunks.length, 80);
  assert.ok(chunks.every(chunk => chunk.length <= 1200));
});

test('tokenizeQuery extracts latin and Chinese tokens', () => {
  const tokens = tokenizeQuery('LinkBox AI 知识库测试');
  assert.ok(tokens.includes('linkbox'));
  assert.ok(tokens.includes('ai'));
  assert.ok(tokens.includes('知识'));
});
