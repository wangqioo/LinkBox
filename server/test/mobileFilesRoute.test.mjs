import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';
import { createJobQueue } from '../utils/jobQueue.js';
import { setRuntimeQueue } from '../utils/runtimeQueue.js';

async function withMobileFilesApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-mobile-files-route-test-'));
  const oldDbPath = process.env.DB_PATH;
  const oldDataDir = process.env.DATA_DIR;
  const oldUploadsDir = process.env.UPLOADS_DIR;
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.DATA_DIR = dir;
  process.env.UPLOADS_DIR = join(dir, 'uploads');

  let db;
  let server;
  try {
    const token = `${Date.now()}-${Math.random()}`;
    const dbModule = await import(`../db.js?mobile-files-db=${token}`);
    db = dbModule.default;
    setRuntimeQueue(createJobQueue({ db, autoStart: false }));
    const mobileFilesModule = await import(`../routes/mobileFiles.js?mobile-files-route-test=${token}`);

    db.prepare(`
      INSERT INTO users (id, username, password_hash)
      VALUES (7, 'mobile-user', 'hash')
      ON CONFLICT(id) DO NOTHING
    `).run();

    const app = express();
    app.use('/api/mobile/files', mobileFilesModule.default);

    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.on('error', reject);
    });

    return await fn({
      db,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      authHeaders: {
        Authorization: `Bearer ${generateToken(7)}`,
      },
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    setRuntimeQueue(null);
    db?.close();
    process.env.DB_PATH = oldDbPath;
    process.env.DATA_DIR = oldDataDir;
    process.env.UPLOADS_DIR = oldUploadsDir;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('mobile upload guards generic URLs and queues allowed Bilibili share links', async () => withMobileFilesApp(async ({ db, baseUrl, authHeaders }) => {
  const form = new FormData();
  form.append('url', 'https://example.com/article');

  const response = await fetch(`${baseUrl}/api/mobile/files/upload`, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.type, 'text');
  assert.equal(body.content, 'https://example.com/article');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count, 0);

  const shareForm = new FormData();
  shareForm.append('url', '【B站独家】罗哥深夜对谈 https://www.bilibili.com/video/BV1ZBjB6UEbt/?share_source=copy_web');

  const shareResponse = await fetch(`${baseUrl}/api/mobile/files/upload`, {
    method: 'POST',
    headers: authHeaders,
    body: shareForm,
  });
  const shareBody = await shareResponse.json();
  const job = db.prepare('SELECT type, link_id, payload FROM jobs').get();

  assert.equal(shareResponse.status, 200);
  assert.equal(shareBody.type, 'link');
  assert.equal(shareBody.url, 'https://www.bilibili.com/video/BV1ZBjB6UEbt/?share_source=copy_web');
  assert.equal(job.type, 'link.fetchMetadata');
  assert.deepEqual(JSON.parse(job.payload), {
    url: 'https://www.bilibili.com/video/BV1ZBjB6UEbt/?share_source=copy_web',
    title: '',
  });
}));

test('mobile comment updates refresh AI indexes for the item', async () => withMobileFilesApp(async ({ db, baseUrl, authHeaders }) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, summary, content_md, imported_at, status)
    VALUES (30, 7, 'image', '图片资料', '旧摘要', '图片原文', '2026-06-21T00:00:00.000Z', 'done')
  `).run();

  const response = await fetch(`${baseUrl}/api/mobile/files/30/comment`, {
    method: 'PUT',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comment: '这张图后续要重点分析左上角按钮' }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.comment, '这张图后续要重点分析左上角按钮');

  const legacyChunk = db.prepare('SELECT text FROM link_chunks WHERE link_id = 30').get();
  assert.match(legacyChunk.text, /这张图后续要重点分析左上角按钮/);

  const document = db.prepare('SELECT markdown FROM documents WHERE item_id = 30').get();
  assert.match(document.markdown, /## 我的留言\n\n这张图后续要重点分析左上角按钮/);
}));
