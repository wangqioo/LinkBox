import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADD_ITEM_TABS,
  ITEM_TYPE_FILTERS,
  getItemTypeLabel,
  isLinkLikeItemType,
} from './itemDisplay.ts';

test('itemDisplay labels normalized item kinds consistently', () => {
  assert.equal(getItemTypeLabel('link'), '链接');
  assert.equal(getItemTypeLabel('article'), '文章');
  assert.equal(getItemTypeLabel('video'), '视频');
  assert.equal(getItemTypeLabel('document'), '文件');
  assert.equal(getItemTypeLabel('file'), '文件');
});

test('itemDisplay exposes shared link-like semantics', () => {
  assert.equal(isLinkLikeItemType('link'), true);
  assert.equal(isLinkLikeItemType('article'), true);
  assert.equal(isLinkLikeItemType('video'), true);
  assert.equal(isLinkLikeItemType('text'), false);
});

test('itemDisplay defines desktop add tabs and filters from one source', () => {
  assert.deepEqual(ADD_ITEM_TABS.map(item => item.key), ['link', 'video', 'image', 'text', 'audio', 'file']);
  assert.deepEqual(ITEM_TYPE_FILTERS.map(item => item.key), ['', 'link', 'video', 'image', 'text', 'audio', 'file']);
});
