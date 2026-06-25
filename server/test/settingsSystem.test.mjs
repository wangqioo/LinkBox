import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';
import { createJobQueue } from '../utils/jobQueue.js';
import { setRuntimeQueue } from '../utils/runtimeQueue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function withSettingsApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-settings-system-test-'));
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
    const dbModule = await import(`../db.js?settings-system-test=${Date.now()}-${Math.random()}`);
    db = dbModule.default;
    const queue = createJobQueue({
      db,
      autoStart: false,
      handlers: {
        'file.extractMarkdown': async () => {},
        'link.summarize': async () => {},
      },
    });
    setRuntimeQueue(queue);
    const settingsModule = await import(`../routes/settings.js?settings-system-test=${Date.now()}-${Math.random()}`);

    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsModule.createSettingsRouter({
      database: db,
      getQueue: () => queue,
      uploadsDir: process.env.UPLOADS_DIR,
    }));

    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, () => resolve(listening));
      listening.on('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    return await fn({
      db,
      queue,
      baseUrl,
      adminHeaders: {
        Authorization: `Bearer ${generateToken(1)}`,
      },
    });
  } finally {
    setRuntimeQueue(null);
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    db?.close();
    process.env.DB_PATH = oldDbPath;
    process.env.DATA_DIR = oldDataDir;
    process.env.UPLOADS_DIR = oldUploadsDir;
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedLink(db, id) {
  db.prepare(`
    INSERT INTO users (id, username, password_hash)
    VALUES (1, 'admin', 'hash')
    ON CONFLICT(id) DO NOTHING
  `).run();
  db.prepare(`
    INSERT INTO links (id, user_id, url, title, status)
    VALUES (?, 1, ?, ?, 'failed')
  `).run(id, `https://example.com/${id}`, `Link ${id}`);
}

function seedFailedJob(db, { id, type, linkId, attempts, maxAttempts, lastError, updatedAt }) {
  db.prepare(`
    INSERT INTO jobs (id, type, link_id, payload, status, attempts, max_attempts, last_error, updated_at)
    VALUES (?, ?, ?, '{}', 'failed', ?, ?, ?, ?)
  `).run(id, type, linkId, attempts, maxAttempts, lastError, updatedAt);
}

test('settings route uses centralized JSON error helpers', () => {
  const routeSource = readFileSync(join(__dirname, '../routes/settings.js'), 'utf8');

  assert.match(routeSource, /jsonError/);
  assert.doesNotMatch(routeSource, /res\.status\([^)]*\)\.json\(\{\s*error:/);
});

test('GET /api/settings/system returns bounded recent failed jobs', async () => withSettingsApp(async ({ db, baseUrl, adminHeaders }) => {
  seedLink(db, 101);
  seedLink(db, 102);
  for (let i = 1; i <= 21; i += 1) {
    seedFailedJob(db, {
      id: i,
      type: i === 20 ? 'link.summarize' : 'file.extractMarkdown',
      linkId: i === 20 ? 101 : 102,
      attempts: i === 20 ? 2 : 3,
      maxAttempts: i === 20 ? 4 : 3,
      lastError: i === 20 ? 'LLM offline' : `parser missing ${i}`,
      updatedAt: `2026-06-16T10:${String(i).padStart(2, '0')}:00.000Z`,
    });
  }

  const response = await fetch(`${baseUrl}/api/settings/system`, { headers: adminHeaders });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.queue.failedJobs.length, 20);
  assert.deepEqual(body.queue.failedJobs[0], {
    id: 21,
    type: 'file.extractMarkdown',
    link_id: 102,
    attempts: 3,
    max_attempts: 3,
    last_error: 'parser missing 21',
    updated_at: '2026-06-16T10:21:00.000Z',
    stage_label: '解析文件正文',
    recovery_hint: '确认文件格式受支持，检查 pdftotext/LibreOffice 等文档解析依赖后重试。',
  });
  assert.deepEqual(body.queue.failedJobs[1], {
    id: 20,
    type: 'link.summarize',
    link_id: 101,
    attempts: 2,
    max_attempts: 4,
    last_error: 'LLM offline',
    updated_at: '2026-06-16T10:20:00.000Z',
    stage_label: '生成网页摘要',
    recovery_hint: '检查 AI 服务地址、模型和 API Key 是否可用后重试。',
  });
  assert.equal(body.queue.failedJobs.some(job => job.id === 1), false);
}));

test('GET /api/settings/system includes storage consistency report', async () => withSettingsApp(async ({ db, baseUrl, adminHeaders }) => {
  db.prepare(`
    INSERT INTO users (id, username, password_hash)
    VALUES (1, 'admin', 'hash')
    ON CONFLICT(id) DO NOTHING
  `).run();
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, content_md, image_path, imported_at)
    VALUES (201, 1, 'file', 'Needs Canonical Rows', '# Missing canonical rows', '/uploads/missing.pdf', '2026-06-18T00:00:00.000Z')
  `).run();

  const response = await fetch(`${baseUrl}/api/settings/system`, { headers: adminHeaders });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.documents.consistency.missing_documents.count, 1);
  assert.equal(body.documents.consistency.missing_content_rows.count, 1);
  assert.equal(body.documents.consistency.missing_asset_rows.count, 1);
  assert.deepEqual(body.documents.consistency.missing_documents.samples[0], {
    id: 201,
    type: 'file',
    title: 'Needs Canonical Rows',
  });
  assert.equal(body.documents.item_understanding.missing_items, 1);
}));

test('POST /api/settings/system/backfill-understanding backfills structured item knowledge', async () => withSettingsApp(async ({ db, baseUrl, adminHeaders }) => {
  db.prepare(`
    INSERT INTO users (id, username, password_hash)
    VALUES (1, 'admin', 'hash')
    ON CONFLICT(id) DO NOTHING
  `).run();
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, summary, comment, imported_at)
    VALUES (301, 1, 'file', 'Agent Memory Notes', 'Agent retrieval needs memory.', 'TODO: add memory review', '2026-06-18T00:00:00.000Z')
  `).run();

  const response = await fetch(`${baseUrl}/api/settings/system/backfill-understanding`, {
    method: 'POST',
    headers: {
      ...adminHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ limit: 10 }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.items, 1);
  assert.equal(body.todos, 1);
  assert.equal(body.stats.item_understanding.missing_items, 0);
}));

test('POST /api/settings/system/retry-failed-jobs retries only selected failed jobs when ids are provided', async () => withSettingsApp(async ({ db, baseUrl, adminHeaders }) => {
  seedLink(db, 101);
  seedLink(db, 102);
  seedFailedJob(db, {
    id: 1,
    type: 'file.extractMarkdown',
    linkId: 101,
    attempts: 3,
    maxAttempts: 3,
    lastError: 'parser missing',
    updatedAt: '2026-06-16T10:01:00.000Z',
  });
  seedFailedJob(db, {
    id: 2,
    type: 'link.summarize',
    linkId: 102,
    attempts: 2,
    maxAttempts: 2,
    lastError: 'LLM offline',
    updatedAt: '2026-06-16T10:02:00.000Z',
  });

  const response = await fetch(`${baseUrl}/api/settings/system/retry-failed-jobs`, {
    method: 'POST',
    headers: {
      ...adminHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: [1] }),
  });
  const body = await response.json();
  await new Promise(resolve => setTimeout(resolve, 20));
  const jobs = db.prepare('SELECT id, status, attempts, last_error FROM jobs ORDER BY id').all();

  assert.equal(response.status, 200);
  assert.equal(body.retried, 1);
  assert.deepEqual(jobs, [
    { id: 1, status: 'done', attempts: 1, last_error: '' },
    { id: 2, status: 'failed', attempts: 2, last_error: 'LLM offline' },
  ]);
}));
