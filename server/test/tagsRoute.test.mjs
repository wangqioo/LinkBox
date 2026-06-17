import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function withTagsApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-tags-route-test-'));
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
    const dbModule = await import(`../db.js?tags-route-db=${token}`);
    db = dbModule.default;
    db.prepare(`
      INSERT INTO users (id, username, password_hash)
      VALUES (1, 'admin', 'hash')
      ON CONFLICT(id) DO NOTHING
    `).run();
    const tagsModule = await import(`../routes/tags.js?tags-route=${token}`);

    const app = express();
    app.use(express.json());
    app.use('/api/tags', tagsModule.default);

    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.on('error', reject);
    });

    return await fn({
      db,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      headers: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
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

test('tags route uses centralized JSON error helpers', () => {
  const routeSource = readFileSync(join(__dirname, '../routes/tags.js'), 'utf8');

  assert.match(routeSource, /jsonError/);
  assert.doesNotMatch(routeSource, /res\.status\([^)]*\)\.json\(\{\s*error:/);
});

test('tags route preserves JSON error status and message responses', async () => withTagsApp(async ({ db, baseUrl, headers }) => {
  const response = await requestJson(`${baseUrl}/api/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ color: '#111111' }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: '标签名不能为空' });

  db.prepare("INSERT INTO tags (user_id, name, color) VALUES (1, 'Read', '#111111')").run();

  const duplicateResponse = await requestJson(`${baseUrl}/api/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Read', color: '#222222' }),
  });

  assert.equal(duplicateResponse.status, 409);
  assert.deepEqual(duplicateResponse.body, { error: '标签已存在' });

  const secondTag = db.prepare("INSERT INTO tags (user_id, name, color) VALUES (1, 'Later', '#333333')").run();
  const duplicateUpdateResponse = await requestJson(`${baseUrl}/api/tags/${secondTag.lastInsertRowid}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: 'Read' }),
  });

  assert.equal(duplicateUpdateResponse.status, 409);
  assert.deepEqual(duplicateUpdateResponse.body, { error: '标签已存在' });

  const updateResponse = await requestJson(`${baseUrl}/api/tags/999`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: 'Later' }),
  });

  assert.equal(updateResponse.status, 404);
  assert.deepEqual(updateResponse.body, { error: '标签不存在' });

  const deleteResponse = await requestJson(`${baseUrl}/api/tags/999`, {
    method: 'DELETE',
    headers,
  });

  assert.equal(deleteResponse.status, 404);
  assert.deepEqual(deleteResponse.body, { error: '标签不存在' });
}));
