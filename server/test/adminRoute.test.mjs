import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function withAdminApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-admin-route-test-'));
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
    const dbModule = await import(`../db.js?admin-route-db=${token}`);
    db = dbModule.default;
    db.prepare(`
      INSERT INTO users (id, username, password_hash)
      VALUES (1, 'admin', 'hash'), (2, 'member', 'hash')
      ON CONFLICT(id) DO NOTHING
    `).run();
    const adminModule = await import(`../routes/admin.js?admin-route=${token}`);

    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminModule.default);

    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.on('error', reject);
    });

    return await fn({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      adminHeaders: {
        Authorization: `Bearer ${generateToken(1)}`,
      },
      memberHeaders: {
        Authorization: `Bearer ${generateToken(2)}`,
      },
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
  const response = await fetch(url, options);
  return {
    status: response.status,
    body: await response.json(),
  };
}

test('admin route uses centralized JSON error helpers', () => {
  const routeSource = readFileSync(join(__dirname, '../routes/admin.js'), 'utf8');

  assert.match(routeSource, /jsonError/);
  assert.doesNotMatch(routeSource, /res\.status\([^)]*\)\.json\(\{\s*error:/);
});

test('admin route preserves JSON error status and message responses', async () => withAdminApp(async ({ baseUrl, adminHeaders, memberHeaders }) => {
  const forbidden = await requestJson(`${baseUrl}/api/admin/users`, {
    headers: memberHeaders,
  });

  assert.equal(forbidden.status, 403);
  assert.deepEqual(forbidden.body, { error: '仅管理员可操作' });

  const invalidUserId = await requestJson(`${baseUrl}/api/admin/users/not-a-number`, {
    headers: adminHeaders,
  });

  assert.equal(invalidUserId.status, 400);
  assert.deepEqual(invalidUserId.body, { error: '用户 ID 无效' });

  const missingUser = await requestJson(`${baseUrl}/api/admin/users/999`, {
    headers: adminHeaders,
  });

  assert.equal(missingUser.status, 404);
  assert.deepEqual(missingUser.body, { error: '用户不存在' });
}));
