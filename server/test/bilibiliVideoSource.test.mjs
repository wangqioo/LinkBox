import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bilibiliProcessingLabel,
  isBilibiliVideoUrl,
  normalizeBilibiliImageUrl,
  videoSourceForUrl,
} from '../utils/bilibiliVideoSource.js';

test('videoSourceForUrl recognizes Bilibili canonical and short video URLs', () => {
  assert.deepEqual(videoSourceForUrl('https://www.bilibili.com/video/BV1GDjB66EE9/?share_source=copy_web'), {
    source: 'bilibili',
    kind: 'video',
    bvid: 'BV1GDjB66EE9',
    url: 'https://www.bilibili.com/video/BV1GDjB66EE9/?share_source=copy_web',
    short: false,
  });
  assert.deepEqual(videoSourceForUrl('https://b23.tv/abc123'), {
    source: 'bilibili',
    kind: 'video',
    bvid: '',
    url: 'https://b23.tv/abc123',
    short: true,
  });
  assert.equal(videoSourceForUrl('https://www.bilibili.com/read/cv123'), null);
});

test('isBilibiliVideoUrl accepts only Bilibili video sources', () => {
  assert.equal(isBilibiliVideoUrl('https://m.bilibili.com/video/BV1ZBjB6UEbt'), true);
  assert.equal(isBilibiliVideoUrl('https://b23.tv/bM46kSH'), true);
  assert.equal(isBilibiliVideoUrl('https://mp.weixin.qq.com/s/abc'), false);
});

test('normalizeBilibiliImageUrl resolves protocol-relative and relative images', () => {
  assert.equal(
    normalizeBilibiliImageUrl('//i1.hdslb.com/bfs/archive/a.jpg', 'https://www.bilibili.com/video/BV1/'),
    'https://i1.hdslb.com/bfs/archive/a.jpg',
  );
  assert.equal(
    normalizeBilibiliImageUrl('/bfs/archive/a.jpg', 'https://www.bilibili.com/video/BV1/'),
    'https://www.bilibili.com/bfs/archive/a.jpg',
  );
});

test('bilibiliProcessingLabel maps durable job types to video user stages', () => {
  assert.equal(bilibiliProcessingLabel('link.fetchMetadata'), '解析视频信息');
  assert.equal(bilibiliProcessingLabel('link.extractMarkdown'), '转写视频文字');
  assert.equal(bilibiliProcessingLabel('link.summarize'), '生成视频摘要');
  assert.equal(bilibiliProcessingLabel('document.embed'), '');
});
