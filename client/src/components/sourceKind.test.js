import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutoProcessLinkUrl, isAllowedAutoProcessUrl, isVideoSourceUrl, itemKindForInput } from './sourceKind.ts';

test('sourceKind extracts allowed source URLs from share text', () => {
  assert.equal(
    getAutoProcessLinkUrl('【B站】 https://www.bilibili.com/video/BV1GDjB66EE9/?share_source=copy_web'),
    'https://www.bilibili.com/video/BV1GDjB66EE9/?share_source=copy_web',
  );
  assert.equal(getAutoProcessLinkUrl('看看这个 https://example.com/a'), '');
});

test('sourceKind separates auto-process eligibility from video source checks', () => {
  assert.equal(isAllowedAutoProcessUrl('https://mp.weixin.qq.com/s/abc'), true);
  assert.equal(isVideoSourceUrl('https://mp.weixin.qq.com/s/abc'), false);
  assert.equal(isVideoSourceUrl('https://b23.tv/abc123'), true);
});

test('sourceKind classifies input item kind for UI fallbacks', () => {
  assert.equal(itemKindForInput({ type: 'link', url: 'https://b23.tv/abc123' }), 'video');
  assert.equal(itemKindForInput({ type: 'file' }), 'document');
  assert.equal(itemKindForInput({ type: 'link', url: 'https://zhuanlan.zhihu.com/p/123' }), 'article');
});
