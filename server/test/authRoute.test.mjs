import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function withAuthApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-auth-route-test-'));
  const dbPath = join(dir, 'test.db');
  const oldDbPath = process.env.DB_PATH;
  const oldDataDir = process.env.DATA_DIR;
  const oldUploadsDir = process.env.UPLOADS_DIR;
  process.env.DB_PATH = dbPath;
  process.env.DATA_DIR = dir;
  process.env.UPLOADS_DIR = join(dir, 'uploads');

  let db;
  let server;
  try {
    const token = `${Date.now()}-${Math.random()}`;
    const dbModule = await import(`../db.js?auth-route-db=${token}`);
    db = dbModule.default;
    const authModule = await import(`../routes/auth.js?auth-route=${token}`);

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authModule.default);

    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.on('error', reject);
    });

    return await fn({
      db,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close();
    process.env.DB_PATH = oldDbPath;
    process.env.DATA_DIR = oldDataDir;
    process.env.UPLOADS_DIR = oldUploadsDir;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test('auth route uses centralized JSON error helpers', () => {
  const routeSource = readFileSync(join(__dirname, '../routes/auth.js'), 'utf8');

  assert.match(routeSource, /jsonError/);
  assert.doesNotMatch(routeSource, /res\.status\([^)]*\)\.json\(\{\s*error:/);
});

test('auth route preserves validation and credential error responses', async () => withAuthApp(async ({ baseUrl }) => {
  const missingRegisterFields = await requestJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ username: '' }),
  });

  assert.equal(missingRegisterFields.status, 400);
  assert.deepEqual(missingRegisterFields.body, { error: '用户名和密码不能为空' });

  const shortPassword = await requestJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: '123' }),
  });

  assert.equal(shortPassword.status, 400);
  assert.deepEqual(shortPassword.body, { error: '密码至少4位' });

  const created = await requestJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: 'pass1234' }),
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.user.username, 'alice');

  const duplicate = await requestJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: 'pass1234' }),
  });

  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.body, { error: '用户名已存在' });

  const missingLoginFields = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username: 'alice' }),
  });

  assert.equal(missingLoginFields.status, 400);
  assert.deepEqual(missingLoginFields.body, { error: '用户名和密码不能为空' });

  const badLogin = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: 'wrong' }),
  });

  assert.equal(badLogin.status, 401);
  assert.deepEqual(badLogin.body, { error: '用户名或密码错误' });
}));
