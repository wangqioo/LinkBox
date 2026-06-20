import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getItemTypeLabel, isLinkLikeItemType } from './linkCardUtils.ts';

test('getItemTypeLabel names normalized web content item types', () => {
  assert.equal(getItemTypeLabel('link'), '链接');
  assert.equal(getItemTypeLabel('article'), '文章');
  assert.equal(getItemTypeLabel('video'), '视频');
  assert.equal(getItemTypeLabel('document'), '文件');
});

test('isLinkLikeItemType groups items that keep an original URL and extracted content', () => {
  assert.equal(isLinkLikeItemType('link'), true);
  assert.equal(isLinkLikeItemType('article'), true);
  assert.equal(isLinkLikeItemType('video'), true);
  assert.equal(isLinkLikeItemType('text'), false);
  assert.equal(isLinkLikeItemType('file'), false);
});
