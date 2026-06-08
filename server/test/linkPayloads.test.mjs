import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeUploadName,
  describeUploadedFile,
  initialFileStatus,
  parseTagIds,
  shouldExtractFile,
} from '../utils/linkPayloads.js';

test('parseTagIds accepts arrays and JSON encoded multipart values', () => {
  assert.deepEqual(parseTagIds([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(parseTagIds('[4,5]'), [4, 5]);
  assert.deepEqual(parseTagIds(''), []);
  assert.deepEqual(parseTagIds(undefined), []);
});

test('parseTagIds rejects malformed multipart tag payloads with a clear error', () => {
  assert.throws(
    () => parseTagIds('{broken'),
    /tag_ids 必须是 JSON 数组/,
  );
  assert.throws(
    () => parseTagIds('{"id":1}'),
    /tag_ids 必须是 JSON 数组/,
  );
});

test('decodeUploadName preserves normal names and fixes latin1 decoded unicode names', () => {
  assert.equal(decodeUploadName('report.pdf'), 'report.pdf');
  assert.equal(decodeUploadName('æµ\x8Bè¯\x95.pdf'), '测试.pdf');
});

test('describeUploadedFile formats KB and MB sizes', () => {
  assert.equal(describeUploadedFile('report.pdf', 2048), 'report.pdf (2 KB)');
  assert.equal(describeUploadedFile('deck.pptx', 1572864), 'deck.pptx (1.5 MB)');
});

test('initialFileStatus reflects supported extraction formats', () => {
  assert.equal(shouldExtractFile('note.md'), true);
  assert.equal(shouldExtractFile('archive.zip'), false);
  assert.equal(initialFileStatus('note.md'), 'processing');
  assert.equal(initialFileStatus('archive.zip'), 'done');
});
