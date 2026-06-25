import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initJobSchema } from '../utils/jobQueue.js';
import { initDocumentSchema, indexDocumentForItem } from '../utils/documentIndex.js';
import {
  backfillItemUnderstanding,
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
  assert.equal(stats.item_understanding.missing_items, 1);
}));

test('getDocumentMaintenanceStats reports missing canonical content and assets', () => withDb((db) => {
  seedLinks(db);
  indexDocumentForItem(db, 1);
  db.exec(`
    CREATE TABLE item_content (
      item_id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      text_content TEXT DEFAULT '',
      extracted_markdown TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      html_note TEXT DEFAULT '',
      content_hash TEXT DEFAULT ''
    );
    CREATE TABLE item_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      public_path TEXT NOT NULL,
      UNIQUE(item_id, kind, public_path)
    );
  `);
  db.prepare(`
    INSERT INTO item_content (item_id, user_id, extracted_markdown, content_hash)
    VALUES (1, 5, 'indexed markdown', 'hash')
  `).run();
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, image_path, thumbnail, imported_at)
    VALUES (4, 5, 'image', 'Missing Asset', '/uploads/photo.png', '/uploads/thumb.png', '2026-06-11T00:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO item_assets (item_id, user_id, kind, public_path)
    VALUES (4, 5, 'image', '/uploads/photo.png')
  `).run();

  const stats = getDocumentMaintenanceStats(db);

  assert.equal(stats.consistency.missing_documents.count, 1);
  assert.deepEqual(stats.consistency.missing_documents.samples, [
    { id: 2, type: 'file', title: 'Missing' },
  ]);
  assert.equal(stats.consistency.missing_content_rows.count, 1);
  assert.deepEqual(stats.consistency.missing_content_rows.samples, [
    { id: 2, type: 'file', title: 'Missing' },
  ]);
  assert.equal(stats.consistency.missing_asset_rows.count, 1);
  assert.deepEqual(stats.consistency.missing_asset_rows.samples, [
    {
      id: 4,
      type: 'image',
      title: 'Missing Asset',
      kind: 'thumbnail',
      public_path: '/uploads/thumb.png',
    },
  ]);
}));

test('getDocumentMaintenanceStats counts missing embeddings for the configured provider and model', () => withDb((db) => {
  seedLinks(db);
  indexDocumentForItem(db, 1);
  const chunk = db.prepare('SELECT id, content_hash FROM document_chunks LIMIT 1').get();
  db.prepare(`
    INSERT INTO document_embeddings (chunk_id, provider, model, dimension, vector, content_hash)
    VALUES (?, 'local', 'linkbox-local-hash-v1', 64, '[1,0]', ?)
  `).run(chunk.id, chunk.content_hash);

  const localStats = getDocumentMaintenanceStats(db, {
    provider: 'local',
    model: 'linkbox-local-hash-v1',
  });
  const remoteStats = getDocumentMaintenanceStats(db, {
    provider: 'openai-compatible',
    model: 'remote-embedding',
  });

  assert.equal(localStats.missing_embeddings, 0);
  assert.equal(remoteStats.missing_embeddings, 1);
  assert.deepEqual(remoteStats.embedding_target, {
    provider: 'openai-compatible',
    model: 'remote-embedding',
  });
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

test('backfillItemUnderstanding populates missing structures in bounded batches', () => withDb((db) => {
  seedLinks(db);

  const first = backfillItemUnderstanding(db, { limit: 1 });
  assert.equal(first.items, 1);
  assert.equal(first.todos, 0);
  assert.equal(first.claims, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM item_topics').get().count, 0);

  db.prepare("UPDATE links SET comment = 'TODO: add launch review', summary = 'Agent retrieval needs memory.' WHERE id = 1").run();
  const second = backfillItemUnderstanding(db, { limit: 10 });
  assert.equal(second.items, 1);
  assert.equal(second.todos, 1);
  assert.equal(second.topics >= 2, true);
  assert.equal(getDocumentMaintenanceStats(db).item_understanding.missing_items, 0);

  const third = backfillItemUnderstanding(db, { limit: 10 });
  assert.equal(third.items, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM item_todos').get().count, 1);
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

test('backfillMissingDocumentEmbeddings is provider and model aware', () => withDb((db) => {
  seedLinks(db);
  indexDocumentForItem(db, 1);
  const chunk = db.prepare('SELECT id, content_hash FROM document_chunks LIMIT 1').get();
  db.prepare(`
    INSERT INTO document_embeddings (chunk_id, provider, model, dimension, vector, content_hash)
    VALUES (?, 'local', 'linkbox-local-hash-v1', 64, '[1,0]', ?)
  `).run(chunk.id, chunk.content_hash);
  const enqueued = [];
  const queue = {
    enqueue(type, options) {
      enqueued.push({ type, options });
      return { id: enqueued.length, type, ...options };
    },
  };

  const result = backfillMissingDocumentEmbeddings(db, queue, {
    provider: 'openai-compatible',
    model: 'remote-embedding',
  });

  assert.equal(result.enqueued, 1);
  assert.deepEqual(enqueued, [{ type: 'document.embed', options: { linkId: 1, maxAttempts: 2 } }]);
}));
