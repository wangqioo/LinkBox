import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  attachProcessingStatus,
  buildProcessingStatus,
} from '../utils/itemProcessingStatus.js';
import { initJobSchema } from '../utils/jobQueue.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-processing-status-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec('CREATE TABLE links (id INTEGER PRIMARY KEY, status TEXT DEFAULT "")');
    db.prepare("INSERT INTO links (id, status) VALUES (7, 'error'), (42, 'processing'), (99, 'done')").run();
    initJobSchema(db);
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('buildProcessingStatus prefers failed jobs and exposes retry metadata', () => {
  const status = buildProcessingStatus(
    { id: 7, status: 'error' },
    [{
      id: 10,
      type: 'file.extractMarkdown',
      status: 'failed',
      attempts: 3,
      max_attempts: 3,
      last_error: 'pdftotext missing',
      updated_at: '2026-06-10T00:00:00.000Z',
    }],
  );

  assert.equal(status.state, 'failed');
  assert.equal(status.stage, 'file.extractMarkdown');
  assert.equal(status.label, '解析文件正文');
  assert.equal(status.canRetry, true);
  assert.equal(status.failedJobId, 10);
  assert.equal(status.lastError, 'pdftotext missing');
});

test('buildProcessingStatus reports active queued or running jobs', () => {
  const status = buildProcessingStatus(
    { id: 42, status: 'processing' },
    [{
      id: 11,
      type: 'link.summarize',
      status: 'running',
      attempts: 1,
      max_attempts: 3,
      last_error: '',
      updated_at: '2026-06-10T00:00:00.000Z',
    }],
  );

  assert.equal(status.state, 'running');
  assert.equal(status.stage, 'link.summarize');
  assert.equal(status.label, '生成网页摘要');
  assert.equal(status.canRetry, false);
  assert.equal(status.activeJob.id, 11);
});

test('buildProcessingStatus reports Bilibili video processing stages', () => {
  const extracting = buildProcessingStatus(
    { id: 43, status: 'processing', url: 'https://www.bilibili.com/video/BV1GDjB66EE9/' },
    [{
      id: 12,
      type: 'link.extractMarkdown',
      status: 'running',
      attempts: 1,
      max_attempts: 3,
      last_error: '',
      updated_at: '2026-06-10T00:00:00.000Z',
    }],
  );
  assert.equal(extracting.label, '转写视频文字');
  assert.equal(extracting.activeJob.label, '转写视频文字');

  const summarizing = buildProcessingStatus(
    { id: 44, status: 'processing', url: 'https://b23.tv/bM46kSH' },
    [{
      id: 13,
      type: 'link.summarize',
      status: 'queued',
      attempts: 0,
      max_attempts: 3,
      last_error: '',
      updated_at: '2026-06-10T00:00:00.000Z',
    }],
  );
  assert.equal(summarizing.label, '生成视频摘要');

  const waiting = buildProcessingStatus(
    { id: 45, status: 'processing', url: 'https://www.bilibili.com/video/BV1GDjB66EE9/' },
    [],
  );
  assert.equal(waiting.label, '等待视频处理');
});

test('attachProcessingStatus derives status for lists from jobs table', () => withDb((db) => {
  db.prepare(`
    INSERT INTO jobs (type, link_id, status, attempts, max_attempts, last_error, updated_at)
    VALUES
      ('file.extractMarkdown', 7, 'failed', 3, 3, 'parser missing', '2026-06-10T00:00:01.000Z'),
      ('link.fetchMetadata', 42, 'queued', 0, 3, '', '2026-06-10T00:00:02.000Z')
  `).run();

  const links = db.prepare('SELECT * FROM links ORDER BY id').all();
  const result = attachProcessingStatus(db, links);

  assert.equal(result[0].processing.state, 'failed');
  assert.equal(result[0].processing.canRetry, true);
  assert.equal(result[1].processing.state, 'queued');
  assert.equal(result[1].processing.label, '抓取网页信息');
  assert.equal(result[2].processing.state, 'done');
}));
