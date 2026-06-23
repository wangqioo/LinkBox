import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';
import { createJobQueue } from '../utils/jobQueue.js';
import { setRuntimeQueue } from '../utils/runtimeQueue.js';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'linkbox-mobile-files-route-test-'));
process.env.DB_PATH = join(TEST_DIR, 'test.db');
process.env.DATA_DIR = TEST_DIR;
process.env.UPLOADS_DIR = join(TEST_DIR, 'uploads');
process.on('exit', () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

async function withMobileFilesApp(fn) {
  let db;
  let server;
  try {
    const dbModule = await import('../db.js');
    db = dbModule.default;
    db.exec(`
      DELETE FROM jobs;
      DELETE FROM link_chunks;
      DELETE FROM document_chunks;
      DELETE FROM documents;
      DELETE FROM links;
      DELETE FROM users;
    `);
    setRuntimeQueue(createJobQueue({ db, autoStart: false }));
    const mobileFilesModule = await import('../routes/mobileFiles.js');

    db.prepare(`
      INSERT INTO users (id, username, password_hash)
      VALUES (7, 'mobile-user', 'hash')
      ON CONFLICT(id) DO NOTHING
    `).run();

    const app = express();
    app.use(express.json());
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
  assert.equal(shareBody.type, 'video');
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

test('mobile personal list hides chat scoped items', async () => withMobileFilesApp(async ({ db, baseUrl, authHeaders }) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, content, imported_at, scope)
    VALUES
      (40, 7, 'text', '个人资料', 'personal note', '2026-06-21T00:00:00.000Z', 'personal'),
      (41, 7, 'text', '群聊资料', 'chat note', '2026-06-22T00:00:00.000Z', 'chat')
  `).run();

  const response = await fetch(`${baseUrl}/api/mobile/files`, { headers: authHeaders });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.map(item => Number(item.id)), [40]);
}));

test('mobile detail can read group shared materials without adding them to the personal list', async () => withMobileFilesApp(async ({ db, baseUrl, authHeaders }) => {
  db.prepare(`
    INSERT INTO users (id, username, password_hash)
    VALUES (8, 'owner-user', 'hash')
    ON CONFLICT(id) DO NOTHING
  `).run();
  db.prepare("INSERT INTO groups (id, owner_id, name) VALUES (70, 8, '资料群')").run();
  db.prepare(`
    INSERT INTO group_members (group_id, user_id, role)
    VALUES
      (70, 7, 'member'),
      (70, 8, 'owner')
  `).run();
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, content, imported_at, scope)
    VALUES (50, 8, 'text', '别人发的群资料', 'shared launch note', '2026-06-23T00:00:00.000Z', 'chat')
  `).run();
  db.prepare("INSERT INTO group_links (group_id, link_id, shared_by, note) VALUES (70, 50, 8, 'for group')").run();

  const detailResponse = await fetch(`${baseUrl}/api/mobile/files/50`, { headers: authHeaders });
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.filename, '别人发的群资料');

  const listResponse = await fetch(`${baseUrl}/api/mobile/files`, { headers: authHeaders });
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.deepEqual(list.map(item => Number(item.id)), []);
}));
