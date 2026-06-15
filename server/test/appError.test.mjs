import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, errorPayload, httpError, jsonError } from '../utils/appError.js';

function createResponse() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
  };
}

test('httpError preserves explicit HTTP status and message', () => {
  const err = httpError(404, '不存在');

  assert.ok(err instanceof AppError);
  assert.equal(err.status, 404);
  assert.equal(err.expose, true);
  assert.equal(err.message, '不存在');
});

test('errorPayload exposes expected errors without fallback prefixes', () => {
  const payload = errorPayload(httpError(400, 'URL 不能为空'), '创建失败');

  assert.deepEqual(payload, {
    status: 400,
    body: { error: 'URL 不能为空' },
  });
});

test('errorPayload wraps unexpected errors as 500 with a fallback prefix', () => {
  const payload = errorPayload(new Error('database locked'), '更新失败');

  assert.deepEqual(payload, {
    status: 500,
    body: { error: '更新失败: database locked' },
  });
});

test('jsonError writes the normalized JSON error response', () => {
  const res = createResponse();

  const returned = jsonError(res, new Error('LLM offline'), '摘要失败');

  assert.equal(returned, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.jsonBody, { error: '摘要失败: LLM offline' });
});
