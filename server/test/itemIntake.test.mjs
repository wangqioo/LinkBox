import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initJobSchema } from '../utils/jobQueue.js';
import {
  acceptImportedLinkItems,
  acceptFileItem,
  acceptImageItem,
  acceptLinkItem,
  retryItemProcessing,
  scheduleItemProcessing,
} from '../utils/itemIntake.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-item-intake-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'link',
        url TEXT DEFAULT '',
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        thumbnail TEXT DEFAULT '',
        comment TEXT DEFAULT '',
        content TEXT DEFAULT '',
        image_path TEXT DEFAULT '',
        imported_at TEXT DEFAULT '',
        created_at TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        status TEXT DEFAULT '',
        content_md TEXT DEFAULT '',
        html_note TEXT DEFAULT '',
        batch_id TEXT DEFAULT '',
        batch_index INTEGER DEFAULT 0
      );
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#6366f1'
      );
      CREATE TABLE link_tags (
        link_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (link_id, tag_id)
      );
    `);
    initJobSchema(db);
    db.prepare("INSERT INTO tags (id, user_id, name) VALUES (1, 5, 'AI')").run();
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function createQueue() {
  const calls = [];
  return {
    calls,
    drained: false,
    enqueue(type, options) {
      calls.push({ type, options });
      return { id: calls.length, type, ...options };
    },
    retryFailedJobsForLink() {
      return 0;
    },
    drain() {
      this.drained = true;
    },
  };
}

test('acceptLinkItem saves a processing item and schedules metadata extraction', () => withDb((db) => {
  const queue = createQueue();

  const result = acceptLinkItem(db, queue, {
    userId: 5,
    url: 'https://example.com',
    tagIds: [1],
    importedAt: '2026-06-15T00:00:00.000Z',
  });

  assert.equal(result.link.type, 'link');
  assert.equal(result.link.status, 'processing');
  assert.deepEqual(result.link.tags.map(tag => tag.name), ['AI']);
  assert.deepEqual(queue.calls, [{
    type: 'link.fetchMetadata',
    options: {
      linkId: result.link.id,
      payload: { url: 'https://example.com', title: '' },
      maxAttempts: 3,
    },
  }]);
}));

test('acceptImageItem schedules image description and can drain immediately', () => withDb((db) => {
  const queue = createQueue();

  const result = acceptImageItem(db, queue, {
    userId: 5,
    imagePath: '/uploads/photo.png',
    diskPath: '/tmp/photo.png',
    originalName: 'photo.png',
    importedAt: '2026-06-15T00:00:00.000Z',
    batchId: 'batch-abc',
    batchIndex: 2,
    drain: true,
  });

  assert.equal(result.link.type, 'image');
  assert.equal(result.link.status, 'processing');
  assert.equal(result.link.batch_id, 'batch-abc');
  assert.equal(result.link.batch_index, 2);
  assert.equal(queue.drained, true);
  assert.deepEqual(queue.calls, [{
    type: 'image.describe',
    options: {
      linkId: result.link.id,
      payload: { diskPath: '/tmp/photo.png' },
      maxAttempts: 3,
    },
  }]);
}));

test('acceptFileItem only schedules extraction for supported files', () => withDb((db) => {
  const queue = createQueue();

  const supported = acceptFileItem(db, queue, {
    userId: 5,
    filePath: '/uploads/report.html',
    diskPath: '/tmp/report.html',
    originalName: 'report.html',
    sizeBytes: 2048,
    importedAt: '2026-06-15T00:00:00.000Z',
  });
  const unsupported = acceptFileItem(db, queue, {
    userId: 5,
    filePath: '/uploads/archive.zip',
    diskPath: '/tmp/archive.zip',
    originalName: 'archive.zip',
    sizeBytes: 4096,
    importedAt: '2026-06-15T00:00:00.000Z',
  });

  assert.equal(supported.link.status, 'processing');
  assert.equal(unsupported.link.status, 'done');
  assert.deepEqual(queue.calls, [{
    type: 'file.extractMarkdown',
    options: {
      linkId: supported.link.id,
      payload: {
        diskPath: '/tmp/report.html',
        originalName: 'report.html',
        isHtml: true,
      },
      maxAttempts: 3,
    },
  }]);
}));

test('retryItemProcessing requeues failed durable jobs and drains the queue', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, imported_at, status)
    VALUES (1, 5, 'link', 'https://example.com', 'Example', '2026-06-15T00:00:00.000Z', 'error')
  `).run();
  db.prepare(`
    INSERT INTO jobs (type, link_id, status, attempts, max_attempts, last_error)
    VALUES ('link.summarize', 1, 'failed', 3, 3, 'LLM offline')
  `).run();
  const queue = createQueue();
  queue.retryFailedJobsForLink = linkId => {
    db.prepare(`
      UPDATE jobs
      SET status = 'queued', attempts = 0, last_error = ''
      WHERE status = 'failed' AND link_id = ?
    `).run(linkId);
    return 1;
  };

  const result = retryItemProcessing(db, queue, { linkId: 1, userId: 5 });

  const job = db.prepare('SELECT status, attempts, last_error FROM jobs WHERE link_id = 1').get();
  assert.equal(result.retried, 1);
  assert.equal(result.link.status, 'processing');
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 0);
  assert.equal(job.last_error, '');
  assert.equal(queue.drained, true);
}));

test('scheduleItemProcessing marks an existing item processing and enqueues the matching job', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, image_path, imported_at, status)
    VALUES
      (1, 5, 'link', 'https://example.com', 'Example', '', '2026-06-15T00:00:00.000Z', 'done'),
      (2, 5, 'file', '', 'report.html', '/uploads/report.html', '2026-06-15T00:00:00.000Z', 'done')
  `).run();
  const queue = createQueue();

  const linkResult = scheduleItemProcessing(db, queue, {
    linkId: 1,
    userId: 5,
    drain: true,
  });
  const fileResult = scheduleItemProcessing(db, queue, {
    linkId: 2,
    userId: 5,
    diskPath: '/tmp/report.html',
  });

  assert.equal(linkResult.link.status, 'processing');
  assert.equal(fileResult.link.status, 'processing');
  assert.equal(queue.drained, true);
  assert.deepEqual(queue.calls, [
    {
      type: 'link.fetchMetadata',
      options: {
        linkId: 1,
        payload: { url: 'https://example.com', title: '' },
        maxAttempts: 3,
      },
    },
    {
      type: 'file.extractMarkdown',
      options: {
        linkId: 2,
        payload: {
          diskPath: '/tmp/report.html',
          originalName: 'report.html',
          isHtml: true,
        },
        maxAttempts: 3,
      },
    },
  ]);
}));

test('acceptImportedLinkItems imports multiple links and schedules metadata jobs', () => withDb((db) => {
  const queue = createQueue();

  const result = acceptImportedLinkItems(db, queue, {
    userId: 5,
    items: [
      'https://a.example',
      { url: 'https://b.example', title: 'B' },
      { title: 'missing url' },
    ],
  });

  assert.deepEqual(result, { imported: 2 });
  assert.deepEqual(queue.calls.map(call => ({
    type: call.type,
    payload: call.options.payload,
  })), [
    {
      type: 'link.fetchMetadata',
      payload: { url: 'https://a.example', title: '' },
    },
    {
      type: 'link.fetchMetadata',
      payload: { url: 'https://b.example', title: 'B' },
    },
  ]);
}));
