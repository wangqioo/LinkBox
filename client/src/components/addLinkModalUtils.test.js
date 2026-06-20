import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutoProcessLinkUrl, isBilibiliVideoUrl, isUrl } from './addLinkModalUtils.ts';

test('getAutoProcessLinkUrl extracts Bilibili share URLs from copied title text', () => {
  const text = '【花37天，破解上海最贵汉堡，成本只要。。。】 https://www.bilibili.com/video/BV1GDjB66EE9/?share_source=copy_web&vd_source=c7eacf65356bd9b3ebb5403b8ff1d512';
  assert.equal(
    getAutoProcessLinkUrl(text),
    'https://www.bilibili.com/video/BV1GDjB66EE9/?share_source=copy_web&vd_source=c7eacf65356bd9b3ebb5403b8ff1d512',
  );
  assert.equal(getAutoProcessLinkUrl('【B站】 https://b23.tv/abc123'), 'https://b23.tv/abc123');
});

test('getAutoProcessLinkUrl keeps generic share text from being auto-processed', () => {
  assert.equal(getAutoProcessLinkUrl('看看这个 https://example.com/article'), '');
  assert.equal(isUrl('看看这个 https://example.com/article'), false);
});

test('isBilibiliVideoUrl accepts only supported video share input', () => {
  assert.equal(isBilibiliVideoUrl('https://www.bilibili.com/video/BV1GDjB66EE9/'), true);
  assert.equal(isBilibiliVideoUrl('https://www.bilibili.com/read/cv123'), false);
});
