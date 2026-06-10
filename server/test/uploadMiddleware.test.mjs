import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUploadFilename,
  isAudioMime,
  isImageMime,
} from '../utils/uploadMiddleware.js';

test('createUploadFilename preserves the original extension with a generated id', () => {
  assert.equal(createUploadFilename('report.final.pdf', 'abc123'), 'abc123.pdf');
  assert.equal(createUploadFilename('no-extension', 'abc123'), 'abc123');
});

test('isImageMime accepts only image mimetypes', () => {
  assert.equal(isImageMime('image/png'), true);
  assert.equal(isImageMime('image/svg+xml'), true);
  assert.equal(isImageMime('application/pdf'), false);
});

test('isAudioMime accepts audio and octet-stream mobile recordings', () => {
  assert.equal(isAudioMime('audio/webm'), true);
  assert.equal(isAudioMime('application/octet-stream'), true);
  assert.equal(isAudioMime('video/mp4'), false);
});
