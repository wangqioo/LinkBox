import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import {
  normalizeUploadedAsset,
} from '../utils/uploadedAsset.js';

test('normalizeUploadedAsset decodes names and derives public and disk paths', () => {
  const asset = normalizeUploadedAsset({
    filename: 'abc123.pdf',
    originalname: 'æµ\x8Bè¯\x95.pdf',
    path: '/tmp/linkbox/abc123.pdf',
    size: 2048,
    mimetype: 'application/pdf',
  }, {
    uploadsDir: '/tmp/linkbox',
  });

  assert.equal(asset.originalName, '测试.pdf');
  assert.equal(asset.publicPath, '/uploads/abc123.pdf');
  assert.equal(asset.diskPath, '/tmp/linkbox/abc123.pdf');
  assert.equal(asset.description, '测试.pdf (2 KB)');
  assert.equal(asset.sizeBytes, 2048);
});

test('normalizeUploadedAsset falls back to uploadsDir when Multer path is absent', () => {
  const asset = normalizeUploadedAsset({
    filename: 'mobile-note.md',
    originalname: 'note.md',
    size: 512,
    mimetype: 'text/markdown',
  }, {
    uploadsDir: '/var/linkbox/uploads',
  });

  assert.equal(asset.diskPath, join('/var/linkbox/uploads', 'mobile-note.md'));
  assert.equal(asset.publicPath, '/uploads/mobile-note.md');
});

test('normalizeUploadedAsset exposes supported extraction metadata and HTML flags', () => {
  const html = normalizeUploadedAsset({
    filename: 'page.htm',
    originalname: 'Page.HTM',
    path: '/tmp/page.htm',
    size: 1024,
    mimetype: 'text/html',
  });
  const unsupported = normalizeUploadedAsset({
    filename: 'archive.zip',
    originalname: 'archive.zip',
    path: '/tmp/archive.zip',
    size: 4096,
    mimetype: 'application/zip',
  });

  assert.equal(html.supportedProcessing, true);
  assert.equal(html.status, 'processing');
  assert.equal(html.isHtml, true);
  assert.deepEqual(html.processingPayload, {
    diskPath: '/tmp/page.htm',
    originalName: 'Page.HTM',
    isHtml: true,
  });

  assert.equal(unsupported.supportedProcessing, false);
  assert.equal(unsupported.status, 'done');
  assert.equal(unsupported.isHtml, false);
  assert.equal(unsupported.processingPayload, null);
});

test('normalizeUploadedAsset classifies image, audio, and generic file uploads', () => {
  assert.equal(normalizeUploadedAsset({
    filename: 'photo.bin',
    originalname: 'photo.png',
    path: '/tmp/photo.bin',
    size: 100,
    mimetype: 'application/octet-stream',
  }).uploadType, 'image');

  assert.equal(normalizeUploadedAsset({
    filename: 'recording.webm',
    originalname: 'recording.webm',
    path: '/tmp/recording.webm',
    size: 100,
    mimetype: 'audio/webm',
  }).uploadType, 'audio');

  assert.equal(normalizeUploadedAsset({
    filename: 'report.pdf',
    originalname: 'report.pdf',
    path: '/tmp/report.pdf',
    size: 100,
    mimetype: 'application/pdf',
  }).uploadType, 'file');
});
