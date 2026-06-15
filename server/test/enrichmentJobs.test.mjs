import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initJobSchema } from '../utils/jobQueue.js';
import { initDocumentSchema } from '../utils/documentIndex.js';
import {
  enqueueDocumentEmbedding,
  registerEnrichmentJobs,
} from '../utils/enrichmentJobs.js';

async function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-enrichment-jobs-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY,
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
        html_note TEXT DEFAULT ''
      );
      CREATE TABLE link_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL
      );
    `);
    initJobSchema(db);
    initDocumentSchema(db);
    return await fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function createQueue() {
  const handlers = {};
  const jobs = [];
  return {
    handlers,
    jobs,
    register(type, handler) {
      handlers[type] = handler;
    },
    enqueue(type, options) {
      jobs.push({ type, options });
      return { id: jobs.length, type, ...options };
    },
  };
}

test('enqueueDocumentEmbedding skips duplicate queued embedding jobs for a link', async () => withDb((db) => {
  db.prepare("INSERT INTO links (id, user_id, type, title) VALUES (1, 5, 'file', 'Doc')").run();
  db.prepare("INSERT INTO jobs (type, link_id, payload, status) VALUES ('document.embed', 1, '{}', 'queued')").run();
  const queue = createQueue();

  const result = enqueueDocumentEmbedding(db, queue, 1);

  assert.equal(result, null);
  assert.deepEqual(queue.jobs, []);
}));

test('document.embed job indexes missing document embeddings asynchronously', async () => withDb(async (db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 5, 'file', 'Doc', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Doc

semantic vector body`);
  const queue = createQueue();
  registerEnrichmentJobs(queue, {
    uploadsDir: '',
    db,
    embedDocuments: async (database) => {
      database.prepare(`
        INSERT INTO document_embeddings (chunk_id, provider, model, dimension, vector, content_hash)
        SELECT id, 'test', 'test-model', 2, '[1,0]', content_hash FROM document_chunks
      `).run();
      return { indexed: 1, provider: 'test', model: 'test-model' };
    },
  });

  await queue.handlers['document.embed']({ link_id: 1, payload: {} });

  const stored = db.prepare('SELECT provider, model FROM document_embeddings').get();
  assert.deepEqual(stored, { provider: 'test', model: 'test-model' });
}));

test('link.extractMarkdown persists extracted content through the injected database', async () => withDb(async (db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title)
    VALUES (1, 5, 'link', 'https://article.example', 'Article')
  `).run();
  const queue = createQueue();

  registerEnrichmentJobs(queue, {
    uploadsDir: '',
    db,
    extractMarkdown: async (url) => {
      assert.equal(url, 'https://article.example');
      return { markdown: '# Extracted\n\nBody' };
    },
  });

  await queue.handlers['link.extractMarkdown']({ link_id: 1, payload: {} });

  const row = db.prepare('SELECT content_md FROM links WHERE id = 1').get();
  assert.equal(row.content_md, '# Extracted\n\nBody');
  assert.deepEqual(queue.jobs.map(job => job.type), ['document.embed', 'link.summarize']);
}));
