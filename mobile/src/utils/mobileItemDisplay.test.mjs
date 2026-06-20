import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commentPreviewText,
  fileIcon,
  fileLabel,
  fileTypeBackground,
  iconBackgroundClass,
  isLinkLikeType,
} from './mobileItemDisplay.js';

test('mobile item display labels first-class source and media types', () => {
  assert.equal(fileLabel('link'), '链接');
  assert.equal(fileLabel('article'), '文章');
  assert.equal(fileLabel('video'), '视频');
  assert.equal(fileLabel('document'), '文档');
  assert.equal(fileLabel('unknown'), '其他');
});

test('mobile item display exposes stable icons and backgrounds', () => {
  assert.equal(fileIcon('video'), '🎬');
  assert.equal(fileIcon('article'), '📖');
  assert.equal(fileIcon('unknown'), '📦');
  assert.equal(fileTypeBackground('article'), 'rgba(100,170,255,.15)');
  assert.equal(iconBackgroundClass('article'), 'ico-blue');
  assert.equal(iconBackgroundClass('unknown'), 'ico-gray');
});

test('mobile item display groups URL-backed items as link-like', () => {
  assert.equal(isLinkLikeType('link'), true);
  assert.equal(isLinkLikeType('article'), true);
  assert.equal(isLinkLikeType('video'), true);
  assert.equal(isLinkLikeType('image'), false);
});

test('commentPreviewText trims blank comments for feed display', () => {
  assert.equal(commentPreviewText(''), '');
  assert.equal(commentPreviewText('   \n  '), '');
  assert.equal(commentPreviewText('  第一行\n\n第二行  '), '第一行\n第二行');
});
