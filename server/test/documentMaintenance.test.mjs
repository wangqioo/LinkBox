import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initJobSchema } from '../utils/jobQueue.js';
import { initDocumentSchema, indexDocumentForItem } from '../utils/documentIndex.js';
import {
  backfillMissingDocumentEmbeddings,
  getDocumentMaintenanceStats,
  reindexAllDocuments,
} from '../utils/documentMaintenance.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-document-maintenance-test-'));
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
    `);
    initJobSchema(db);
    initDocumentSchema(db);
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedLinks(db) {
  const insert = db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md, summary)
    VALUES (?, 5, ?, ?, '2026-06-11T00:00:00.000Z', ?, '')
  `);
  insert.run(1, 'file', 'Indexed', `# Indexed

## One

Body one`);
  insert.run(2, 'file', 'Missing', `# Missing

## Two

Body two`);
  insert.run(3, 'link', 'No Content', '');
}

test('getDocumentMaintenanceStats reports document, chunk, embedding, and job counts', () => withDb((db) => {
  seedLinks(db);
  indexDocumentForItem(db, 1);
  db.prepare("INSERT INTO jobs (type, link_id, status, payload) VALUES ('document.embed', 1, 'failed', '{}')").run();

  const stats = getDocumentMaintenanceStats(db);

  assert.equal(stats.items_with_content, 2);
  assert.equal(stats.documents, 1);
  assert.equal(stats.missing_documents, 1);
  assert.equal(stats.chunks, 1);
  assert.equal(stats.embeddings, 0);
  assert.equal(stats.missing_embeddings, 1);
  assert.equal(stats.embedding_jobs.failed, 1);
}));

test('reindexAllDocuments builds documents for content-bearing links', () => withDb((db) => {
  seedLinks(db);
  indexDocumentForItem(db, 1);

  const result = reindexAllDocuments(db);

  assert.equal(result.documents, 2);
  assert.equal(result.chunks, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM documents').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM document_chunks').get().count, 2);
}));

test('backfillMissingDocumentEmbeddings enqueues one document.embed job per link without duplicates', () => withDb((db) => {
  seedLinks(db);
  indexDocumentForItem(db, 1);
  indexDocumentForItem(db, 2);
  db.prepare("INSERT INTO jobs (type, link_id, status, payload) VALUES ('document.embed', 1, 'queued', '{}')").run();
  const enqueued = [];
  const queue = {
    enqueue(type, options) {
      enqueued.push({ type, options });
      db.prepare('INSERT INTO jobs (type, link_id, status, payload) VALUES (?, ?, ?, ?)')
        .run(type, options.linkId, 'queued', JSON.stringify(options.payload || {}));
      return { id: enqueued.length, type, ...options };
    },
  };

  const result = backfillMissingDocumentEmbeddings(db, queue);

  assert.equal(result.enqueued, 1);
  assert.deepEqual(enqueued, [{ type: 'document.embed', options: { linkId: 2, maxAttempts: 2 } }]);
}));
