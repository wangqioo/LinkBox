# Durable Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a SQLite-backed durable background job system and move LinkBox enrichment work onto it.

**Architecture:** Add a `jobs` table and a small queue module that leases, retries, and records background work. Keep routes focused on HTTP/database acceptance, and move link/image/file enrichment into job handlers registered at server startup.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, node:test, React/Vite docs verification.

---

## File Structure

- Create `server/utils/jobQueue.js`: durable queue storage, leasing, retry, recovery, stats, and runner.
- Create `server/utils/enrichmentJobs.js`: job handlers for link metadata, extraction, summarization, image description, and file extraction.
- Create `server/test/jobQueue.test.mjs`: queue behavior tests using temporary SQLite databases.
- Create `server/test/chunkIndex.test.mjs`: chunk/index tests using temporary SQLite databases.
- Modify `server/db.js`: add `jobs` table and indexes.
- Modify `server/index.js`: register enrichment jobs and start the worker loop.
- Modify `server/routes/links.js`: enqueue durable jobs instead of in-memory tasks.
- Modify `server/routes/settings.js`: expose durable queue stats.
- Modify `server/package.json`: add `test` script.
- Modify `README.md` and `docs/taishanpi-deploy.md`: align runtime docs with port 3100 and durable processing.

## Tasks

### Task 1: Backend Test Harness And Queue Schema

**Files:**
- Modify: `server/package.json`
- Modify: `server/db.js`
- Create: `server/test/jobQueue.test.mjs`

- [ ] Add a `test` script to `server/package.json`:

```json
"test": "node --test"
```

- [ ] Add the `jobs` table to `server/db.js`:

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  link_id INTEGER,
  payload TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_run_at TEXT DEFAULT (datetime('now')),
  locked_at TEXT DEFAULT '',
  last_error TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT '',
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run ON jobs(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_link ON jobs(link_id);
```

- [ ] Write `server/test/jobQueue.test.mjs` with a failing import:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createJobQueue, initJobSchema } from '../utils/jobQueue.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-job-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    initJobSchema(db);
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('enqueue stores a queued job with JSON payload', () => withDb((db) => {
  const queue = createJobQueue({ db, autoStart: false });
  const job = queue.enqueue('link.fetchMetadata', { linkId: 42, payload: { url: 'https://example.com' } });

  assert.equal(job.type, 'link.fetchMetadata');
  assert.equal(job.link_id, 42);
  assert.equal(job.status, 'queued');
  assert.deepEqual(JSON.parse(job.payload), { url: 'https://example.com' });
}));

test('recoverRunningJobs returns stale running jobs to queued', () => withDb((db) => {
  db.prepare(`
    INSERT INTO jobs (type, link_id, payload, status, attempts, max_attempts, locked_at)
    VALUES ('link.summarize', 7, '{}', 'running', 1, 3, datetime('now', '-1 hour'))
  `).run();
  const queue = createJobQueue({ db, autoStart: false });

  const recovered = queue.recoverRunningJobs();
  const row = db.prepare('SELECT status, locked_at FROM jobs').get();

  assert.equal(recovered, 1);
  assert.equal(row.status, 'queued');
  assert.equal(row.locked_at, '');
}));
```

- [ ] Run `cd server && npm test -- test/jobQueue.test.mjs`.

Expected: fails because `server/utils/jobQueue.js` does not exist.

### Task 2: Durable Job Queue Module

**Files:**
- Create: `server/utils/jobQueue.js`
- Test: `server/test/jobQueue.test.mjs`

- [ ] Implement `server/utils/jobQueue.js`:

```js
export function initJobSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      link_id INTEGER,
      payload TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_run_at TEXT DEFAULT (datetime('now')),
      locked_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT '',
      FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run ON jobs(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_link ON jobs(link_id);
  `);
}

function isoNow() {
  return new Date().toISOString();
}

function parsePayload(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function backoffSeconds(attempts) {
  return Math.min(300, Math.max(5, 5 * Math.pow(2, Math.max(0, attempts - 1))));
}

export function createJobQueue({ db, handlers = {}, concurrency = Number(process.env.BACKGROUND_QUEUE_CONCURRENCY || 1), pollIntervalMs = 1000, autoStart = true } = {}) {
  initJobSchema(db);
  const registry = new Map(Object.entries(handlers));
  let timer = null;
  let running = 0;
  let stopped = false;

  function enqueue(type, { linkId = null, payload = {}, maxAttempts = 3 } = {}) {
    const result = db.prepare(`
      INSERT INTO jobs (type, link_id, payload, status, max_attempts, next_run_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)
    `).run(type, linkId, JSON.stringify(payload || {}), maxAttempts, isoNow(), isoNow());
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid);
  }

  function recoverRunningJobs() {
    const result = db.prepare(`
      UPDATE jobs
      SET status = 'queued', locked_at = '', updated_at = ?
      WHERE status = 'running'
    `).run(isoNow());
    return result.changes;
  }

  function leaseNextJob() {
    const job = db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'queued' AND datetime(next_run_at) <= datetime('now')
      ORDER BY id ASC
      LIMIT 1
    `).get();
    if (!job) return null;
    const result = db.prepare(`
      UPDATE jobs
      SET status = 'running', locked_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(isoNow(), isoNow(), job.id);
    if (!result.changes) return null;
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
  }

  function markDone(id) {
    db.prepare(`
      UPDATE jobs
      SET status = 'done', locked_at = '', last_error = '', completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(isoNow(), isoNow(), id);
  }

  function markFailed(job, error) {
    const message = String(error?.message || error || 'Unknown job error').slice(0, 1000);
    if (job.attempts >= job.max_attempts) {
      db.prepare(`
        UPDATE jobs
        SET status = 'failed', locked_at = '', last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(message, isoNow(), job.id);
      return;
    }
    db.prepare(`
      UPDATE jobs
      SET status = 'queued',
          locked_at = '',
          last_error = ?,
          next_run_at = datetime('now', ?),
          updated_at = ?
      WHERE id = ?
    `).run(message, `+${backoffSeconds(job.attempts)} seconds`, isoNow(), job.id);
  }

  async function runJob(job) {
    const handler = registry.get(job.type);
    if (!handler) {
      markFailed(job, new Error(`No handler registered for job type ${job.type}`));
      return;
    }
    try {
      await handler({ ...job, payload: parsePayload(job.payload) });
      markDone(job.id);
    } catch (error) {
      markFailed(job, error);
    }
  }

  function drain() {
    if (stopped) return;
    while (running < Math.max(1, Number(concurrency) || 1)) {
      const job = leaseNextJob();
      if (!job) break;
      running += 1;
      Promise.resolve(runJob(job)).finally(() => {
        running -= 1;
        drain();
      });
    }
  }

  function start() {
    if (timer) return;
    stopped = false;
    recoverRunningJobs();
    drain();
    timer = setInterval(drain, pollIntervalMs);
    timer.unref?.();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function register(type, handler) {
    registry.set(type, handler);
  }

  function stats() {
    const rows = db.prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status').all();
    const counts = Object.fromEntries(rows.map(row => [row.status, row.count]));
    const lastFailed = db.prepare(`
      SELECT id, type, link_id, attempts, last_error, updated_at
      FROM jobs
      WHERE status = 'failed'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get() || null;
    return {
      concurrency: Math.max(1, Number(concurrency) || 1),
      running,
      queued: counts.queued || 0,
      leased: counts.running || 0,
      done: counts.done || 0,
      failed: counts.failed || 0,
      lastFailed,
    };
  }

  const api = { enqueue, recoverRunningJobs, leaseNextJob, markDone, markFailed, runJob, drain, start, stop, register, stats };
  if (autoStart) start();
  return api;
}
```

- [ ] Run `cd server && npm test -- test/jobQueue.test.mjs`.

Expected: both tests pass.

### Task 3: Enrichment Job Handlers

**Files:**
- Create: `server/utils/enrichmentJobs.js`
- Modify: `server/routes/links.js`
- Modify: `server/index.js`
- Test: `server/test/jobQueue.test.mjs`

- [ ] Create `server/utils/enrichmentJobs.js` with handlers that use existing utilities:

```js
import { join } from 'path';
import db from '../db.js';
import { fetchLinkMeta } from './fetchMeta.js';
import { summarizeContent, summarizeMarkdown } from './aiSummarize.js';
import { extractPageMarkdown } from './extractContent.js';
import { describeImage, fileToMarkdown } from './fileToMarkdown.js';
import { indexLinkContent } from './chunkIndex.js';

function updateStatus(linkId, status) {
  db.prepare('UPDATE links SET status = ? WHERE id = ?').run(status, linkId);
}

function getLink(linkId) {
  return db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
}

export function registerEnrichmentJobs(queue, { uploadsDir }) {
  queue.register('link.fetchMetadata', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;
    if (!payload.title) {
      const meta = await fetchLinkMeta(link.url);
      if (meta.title || meta.description || meta.thumbnail) {
        db.prepare('UPDATE links SET title = ?, description = ?, thumbnail = ? WHERE id = ?')
          .run(meta.title || link.url, meta.description || '', meta.thumbnail || '', linkId);
      }
    }
    queue.enqueue('link.extractMarkdown', { linkId, payload: { url: link.url } });
  });

  queue.register('link.extractMarkdown', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;
    const extracted = await extractPageMarkdown(payload.url || link.url);
    if (extracted?.markdown) {
      db.prepare('UPDATE links SET content_md = ? WHERE id = ?').run(extracted.markdown, linkId);
      indexLinkContent(linkId);
      queue.enqueue('link.summarize', { linkId });
    } else {
      updateStatus(linkId, 'done');
    }
  });

  queue.register('link.summarize', async ({ link_id: linkId }) => {
    const link = getLink(linkId);
    if (!link) return;
    const text = link.content_md && link.content_md.trim()
      ? link.content_md
      : [link.title, link.description].filter(Boolean).join('\n') || link.url;
    const summary = link.content_md && link.content_md.trim()
      ? await summarizeMarkdown(text, link.title || '')
      : await summarizeContent(text, 'link');
    db.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?')
      .run(summary || link.summary || '', 'done', linkId);
  });

  queue.register('image.describe', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;
    updateStatus(linkId, 'processing');
    const description = await describeImage(payload.diskPath);
    const markdown = description
      ? `![image](${link.image_path})\n\n> 图片描述：${description}`
      : `![image](${link.image_path})`;
    db.prepare('UPDATE links SET content_md = ?, summary = ?, status = ? WHERE id = ?')
      .run(markdown, description || '', 'done', linkId);
    indexLinkContent(linkId);
  });

  queue.register('file.extractMarkdown', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;
    if (payload.rawHtml) {
      db.prepare('UPDATE links SET html_note = ? WHERE id = ?').run(payload.rawHtml, linkId);
    }
    const markdown = await fileToMarkdown(payload.diskPath, payload.originalName || link.title, uploadsDir);
    if (!markdown) {
      updateStatus(linkId, 'done');
      return;
    }
    const imgMatch = markdown.match(/!\[.*?\]\((\/uploads\/[^)]+)\)/);
    const thumbnail = imgMatch ? imgMatch[1] : null;
    db.prepare('UPDATE links SET content_md = ?, thumbnail = ? WHERE id = ?').run(markdown, thumbnail, linkId);
    indexLinkContent(linkId);
    queue.enqueue('file.summarize', { linkId });
  });

  queue.register('file.summarize', async ({ link_id: linkId }) => {
    const link = getLink(linkId);
    if (!link) return;
    if (!link.content_md?.trim()) {
      updateStatus(linkId, 'done');
      return;
    }
    const summary = await summarizeMarkdown(link.content_md, link.title || '');
    db.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?')
      .run(summary || link.summary || '', 'done', linkId);
  });
}
```

- [ ] Modify `server/index.js` to create and start the queue:

```js
import { createJobQueue } from './utils/jobQueue.js';
import { registerEnrichmentJobs } from './utils/enrichmentJobs.js';
```

After `uploadsDir` is defined:

```js
export const jobQueue = createJobQueue({ db, autoStart: false });
registerEnrichmentJobs(jobQueue, { uploadsDir });
jobQueue.start();
```

- [ ] Modify `server/routes/links.js` to import `jobQueue` from `../index.js`, remove `backgroundQueue`, and enqueue durable jobs where background tasks currently run.

- [ ] Run `cd server && npm test -- test/jobQueue.test.mjs`.

Expected: queue tests still pass.

### Task 4: Extract Queue Wiring Away From Circular Imports

**Files:**
- Create: `server/utils/runtimeQueue.js`
- Modify: `server/index.js`
- Modify: `server/routes/links.js`

- [ ] Create `server/utils/runtimeQueue.js`:

```js
let queue = null;

export function setRuntimeQueue(nextQueue) {
  queue = nextQueue;
}

export function getRuntimeQueue() {
  if (!queue) throw new Error('Job queue is not initialized');
  return queue;
}
```

- [ ] Change `server/index.js` to import `setRuntimeQueue` and call it after queue creation.

- [ ] Change `server/routes/links.js` to call `getRuntimeQueue()` inside handlers instead of importing from `index.js`.

- [ ] Run `cd server && npm test -- test/jobQueue.test.mjs`.

Expected: queue tests pass and no circular import warning appears.

### Task 5: Link/Image/File Routes Enqueue Durable Jobs

**Files:**
- Modify: `server/routes/links.js`
- Modify: `server/routes/settings.js`

- [ ] Replace link creation background work with:

```js
getRuntimeQueue().enqueue('link.fetchMetadata', {
  linkId: result.lastInsertRowid,
  payload: { url, title: title || '' },
});
```

- [ ] Replace image description background work with:

```js
getRuntimeQueue().enqueue('image.describe', {
  linkId,
  payload: { diskPath },
});
```

- [ ] Replace file extraction background work with:

```js
getRuntimeQueue().enqueue('file.extractMarkdown', {
  linkId,
  payload: { diskPath, originalName, rawHtml },
});
```

- [ ] Replace batch import metadata background work with durable `link.fetchMetadata` jobs.

- [ ] Replace settings system queue stats to read from `getRuntimeQueue().stats()`.

- [ ] Run `cd server && npm test`.

Expected: all backend tests pass.

### Task 6: Core Backend Tests

**Files:**
- Create: `server/test/chunkIndex.test.mjs`
- Modify: `server/package.json` if needed

- [ ] Write tests for chunk splitting:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoChunks, tokenizeQuery } from '../utils/chunkIndex.js';

test('splitIntoChunks preserves short paragraphs as one chunk', () => {
  const chunks = splitIntoChunks('第一段\n\n第二段');
  assert.deepEqual(chunks, ['第一段\n\n第二段']);
});

test('splitIntoChunks caps very long content', () => {
  const chunks = splitIntoChunks('x'.repeat(120000));
  assert.equal(chunks.length, 80);
  assert.ok(chunks.every(chunk => chunk.length <= 1200));
});

test('tokenizeQuery extracts latin and Chinese tokens', () => {
  const tokens = tokenizeQuery('LinkBox AI 知识库测试');
  assert.ok(tokens.includes('linkbox'));
  assert.ok(tokens.includes('ai'));
  assert.ok(tokens.includes('知识'));
});
```

- [ ] Run `cd server && npm test -- test/chunkIndex.test.mjs`.

Expected: tests pass or reveal current tokenizer behavior that must be preserved or improved deliberately.

### Task 7: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/taishanpi-deploy.md`

- [ ] Update README quick start to use port 3100.

- [ ] Add a short note that enrichment jobs are durable and resume after restart.

- [ ] Update TaishanPi docs to mention the durable queue and admin system queue status.

- [ ] Run:

```bash
cd server && npm test
cd ../client && npm run build
cd ../server && node --check index.js
```

Expected: backend tests pass, frontend build passes, server syntax check passes.

- [ ] Commit all changes:

```bash
git add .
git commit -m "Add durable enrichment job queue"
```
