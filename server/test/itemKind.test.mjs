import test from 'node:test';
import assert from 'node:assert/strict';
import {
  itemKindForRow,
  isAllowedAutoProcessUrl,
  isVideoSourceUrl,
  sqlConditionForItemKind,
} from '../utils/itemKind.js';

test('itemKindForRow classifies URL-backed item kinds without changing stored type', () => {
  assert.equal(itemKindForRow({
    type: 'link',
    url: 'https://www.bilibili.com/video/BV1GDjB66EE9/?share_source=copy_web',
  }), 'video');
  assert.equal(itemKindForRow({ type: 'link', url: 'https://b23.tv/bM46kSH' }), 'video');
  assert.equal(itemKindForRow({ type: 'link', url: 'https://mp.weixin.qq.com/s/abc' }), 'article');
  assert.equal(itemKindForRow({ type: 'link', url: 'https://zhuanlan.zhihu.com/p/123' }), 'article');
  assert.equal(itemKindForRow({ type: 'link', url: 'https://example.com/a' }), 'link');
});

test('itemKindForRow normalizes stored file type to document display kind', () => {
  assert.equal(itemKindForRow({ type: 'file', url: '' }), 'document');
  assert.equal(itemKindForRow({ type: 'image', url: '' }), 'image');
  assert.equal(itemKindForRow({ type: 'audio', url: '' }), 'audio');
  assert.equal(itemKindForRow({ type: 'text', url: '' }), 'text');
});

test('source URL helpers expose auto-process and video semantics from one module', () => {
  assert.equal(isAllowedAutoProcessUrl('https://www.bilibili.com/video/BV1ZBjB6UEbt/'), true);
  assert.equal(isAllowedAutoProcessUrl('https://www.bilibili.com/read/cv123'), false);
  assert.equal(isAllowedAutoProcessUrl('https://example.com/article'), false);
  assert.equal(isVideoSourceUrl('https://b23.tv/abc123'), true);
  assert.equal(isVideoSourceUrl('https://mp.weixin.qq.com/s/abc'), false);
});

test('sqlConditionForItemKind provides query condition for video rows', () => {
  const condition = sqlConditionForItemKind('video', 'l');
  assert.match(condition.sql, /l\.type = 'link'/);
  assert.match(condition.sql, /bilibili\.com\/video\/BV/);
  assert.match(condition.sql, /b23\.tv/);
  assert.deepEqual(condition.params, []);
});
