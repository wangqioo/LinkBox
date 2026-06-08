import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createJobQueue, initJobSchema } from '../utils/jobQueue.js';

async function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-job-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec('CREATE TABLE links (id INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO links (id) VALUES (42), (7)').run();
    initJobSchema(db);
    return await fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('enqueue stores a queued job with JSON payload', async () => withDb((db) => {
  const queue = createJobQueue({ db, autoStart: false });
  const job = queue.enqueue('link.fetchMetadata', { linkId: 42, payload: { url: 'https://example.com' } });

  assert.equal(job.type, 'link.fetchMetadata');
  assert.equal(job.link_id, 42);
  assert.equal(job.status, 'queued');
  assert.deepEqual(JSON.parse(job.payload), { url: 'https://example.com' });
}));

test('recoverRunningJobs returns stale running jobs to queued', async () => withDb((db) => {
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

test('runJob retries failed jobs until max attempts is reached', async () => withDb(async (db) => {
  let finalFailure = null;
  const queue = createJobQueue({
    db,
    autoStart: false,
    onFinalFailure: job => {
      finalFailure = job;
    },
    handlers: {
      'link.summarize': async () => {
        throw new Error('LLM offline');
      },
    },
  });
  const first = queue.enqueue('link.summarize', { linkId: 7, maxAttempts: 2 });
  const leasedFirst = queue.leaseNextJob();

  await queue.runJob(leasedFirst);
  const afterFirst = db.prepare('SELECT status, attempts, last_error FROM jobs WHERE id = ?').get(first.id);

  assert.equal(afterFirst.status, 'queued');
  assert.equal(afterFirst.attempts, 1);
  assert.match(afterFirst.last_error, /LLM offline/);

  db.prepare("UPDATE jobs SET next_run_at = datetime('now', '-1 second') WHERE id = ?").run(first.id);
  const leasedSecond = queue.leaseNextJob();
  await queue.runJob(leasedSecond);
  const afterSecond = db.prepare('SELECT status, attempts, last_error FROM jobs WHERE id = ?').get(first.id);

  assert.equal(afterSecond.status, 'failed');
  assert.equal(afterSecond.attempts, 2);
  assert.match(afterSecond.last_error, /LLM offline/);
  assert.equal(finalFailure.id, first.id);
  assert.match(finalFailure.last_error, /LLM offline/);
}));

test('retryFailedJobs returns failed jobs to queued', async () => withDb((db) => {
  db.prepare(`
    INSERT INTO jobs (type, link_id, payload, status, attempts, max_attempts, locked_at, last_error)
    VALUES ('file.extractMarkdown', 7, '{}', 'failed', 3, 3, 'stale-lock', 'parser missing')
  `).run();
  const queue = createJobQueue({ db, autoStart: false });

  const retried = queue.retryFailedJobs();
  const row = db.prepare('SELECT status, attempts, locked_at, last_error FROM jobs').get();

  assert.equal(retried, 1);
  assert.equal(row.status, 'queued');
  assert.equal(row.attempts, 0);
  assert.equal(row.locked_at, '');
  assert.equal(row.last_error, '');
}));
