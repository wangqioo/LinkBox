import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchProxiedImage,
  imageProxyHeaders,
  isWeChatImageUrl,
} from '../utils/imageProxyService.js';

function createResponse({ ok = true, status = 200, contentType = 'image/png', body = 'img' } = {}) {
  return {
    ok,
    status,
    headers: {
      get: key => key.toLowerCase() === 'content-type' ? contentType : null,
    },
    arrayBuffer: async () => Buffer.from(body).buffer,
  };
}

test('isWeChatImageUrl detects common WeChat image hosts', () => {
  assert.equal(isWeChatImageUrl('https://mmbiz.qpic.cn/a.png'), true);
  assert.equal(isWeChatImageUrl('https://example.com/a.png'), false);
});

test('imageProxyHeaders sets referer based on image source', () => {
  assert.equal(imageProxyHeaders('https://mmbiz.qpic.cn/a.png').Referer, 'https://mp.weixin.qq.com/');
  assert.equal(imageProxyHeaders('https://example.com/a.png').Referer, 'https://example.com/');
});

test('fetchProxiedImage returns image buffer and content type', async () => {
  const calls = [];
  const result = await fetchProxiedImage('https://example.com/a.png', {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return createResponse({ body: 'hello' });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'image/png');
  assert.equal(Buffer.isBuffer(result.buffer), true);
  assert.equal(calls[0].url, 'https://example.com/a.png');
  assert.equal(calls[0].options.headers.Referer, 'https://example.com/');
});

test('fetchProxiedImage redirects non-WeChat failures but not WeChat failures', async () => {
  const normal = await fetchProxiedImage('https://example.com/a.png', {
    fetchImpl: async () => createResponse({ ok: false, status: 404 }),
  });
  const wechat = await fetchProxiedImage('https://mmbiz.qpic.cn/a.png', {
    fetchImpl: async () => createResponse({ ok: false, status: 404 }),
  });

  assert.equal(normal.ok, false);
  assert.equal(normal.shouldRedirect, true);
  assert.equal(wechat.ok, false);
  assert.equal(wechat.shouldRedirect, false);
});

test('fetchProxiedImage rejects non-http URLs', async () => {
  await assert.rejects(
    () => fetchProxiedImage('/uploads/a.png'),
    /Invalid image URL/,
  );
});
