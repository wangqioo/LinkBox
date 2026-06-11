import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createItemController } from '../utils/itemController.js';
import { createJobQueue, initJobSchema } from '../utils/jobQueue.js';
import { initDocumentSchema, indexDocumentForItem } from '../utils/documentIndex.js';
import { indexMissingDocumentEmbeddings } from '../utils/documentEmbeddings.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-item-controller-test-'));
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
        html_note TEXT DEFAULT ''
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
    initDocumentSchema(db);
    db.prepare("INSERT INTO tags (id, user_id, name) VALUES (1, 5, 'AI')").run();
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function createResponse() {
  return {
    statusCode: 200,
    jsonBody: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

test('createLink saves the item and enqueues background processing', () => withDb((db) => {
  const enqueued = [];
  const controller = createItemController({
    db,
    getQueue: () => ({
      enqueue(type, options) {
        enqueued.push({ type, options });
      },
    }),
  });
  const req = {
    userId: 5,
    body: {
      url: 'https://example.com',
      comment: 'read later',
      tag_ids: [1],
      imported_at: '2026-06-10T00:00:00.000Z',
    },
  };
  const res = createResponse();

  controller.createLink(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.url, 'https://example.com');
  assert.equal(res.jsonBody.status, 'processing');
  assert.deepEqual(res.jsonBody.tags.map(tag => tag.name), ['AI']);
  assert.deepEqual(enqueued, [{
    type: 'link.fetchMetadata',
    options: {
      linkId: res.jsonBody.id,
      payload: { url: 'https://example.com', title: '' },
    },
  }]);
}));

test('createLink rejects empty URLs before writing or enqueueing', () => withDb((db) => {
  const enqueued = [];
  const controller = createItemController({
    db,
    getQueue: () => ({
      enqueue(type, options) {
        enqueued.push({ type, options });
      },
    }),
  });
  const res = createResponse();

  controller.createLink({ userId: 5, body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, { error: 'URL 不能为空' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM links').get().count, 0);
  assert.deepEqual(enqueued, []);
}));

test('retryProcessing requeues failed jobs and returns updated item status', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, imported_at, status)
    VALUES (1, 5, 'link', 'https://example.com', 'Example', '2026-06-10T00:00:00.000Z', 'error')
  `).run();
  db.prepare(`
    INSERT INTO jobs (type, link_id, status, attempts, max_attempts, last_error)
    VALUES ('link.summarize', 1, 'failed', 3, 3, 'LLM offline')
  `).run();
  const queue = createJobQueue({ db, autoStart: false });
  let drained = false;
  const controller = createItemController({
    db,
    getQueue: () => ({
      retryFailedJobsForLink: queue.retryFailedJobsForLink,
      drain() {
        drained = true;
      },
    }),
  });
  const res = createResponse();

  controller.retryProcessing({ userId: 5, params: { id: 1 } }, res);

  const job = db.prepare('SELECT status, attempts, last_error FROM jobs WHERE link_id = 1').get();
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.status, 'processing');
  assert.equal(res.jsonBody.retried, 1);
  assert.equal(res.jsonBody.processing.state, 'queued');
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 0);
  assert.equal(job.last_error, '');
  assert.equal(drained, true);
}));

test('getDocument returns owned canonical document and chunks', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, imported_at, content_md)
    VALUES (1, 5, 'link', 'https://example.com', 'Example', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Example

## Section

Body text.`);
  indexDocumentForItem(db, 1);
  const controller = createItemController({ db });
  const res = createResponse();

  controller.getDocument({ userId: 5, params: { id: 1 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.item.id, 1);
  assert.equal(res.jsonBody.document.title, 'Example');
  assert.match(res.jsonBody.document.markdown, /source_url: https:\/\/example.com/);
  assert.equal(res.jsonBody.chunks.length, 1);
  assert.equal(res.jsonBody.chunks[0].heading_path, 'Example > Section');
  assert.equal(res.jsonBody.stats.chunk_count, 1);
}));

test('getDocument reports embedding coverage for indexed chunks', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, imported_at, content_md)
    VALUES (1, 5, 'link', 'https://example.com', 'Example', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Example

## Embeddings

Vector-ready body.`);
  indexDocumentForItem(db, 1);
  indexMissingDocumentEmbeddings(db);
  const controller = createItemController({ db });
  const res = createResponse();

  controller.getDocument({ userId: 5, params: { id: 1 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.embeddings.indexed, 1);
  assert.equal(res.jsonBody.embeddings.missing, 0);
  assert.equal(res.jsonBody.embeddings.models[0].provider, 'local');
  assert.equal(res.jsonBody.embeddings.models[0].dimension, 64);
}));

test('getDocument rejects foreign items and reports missing document', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title)
    VALUES (1, 8, 'text', 'Foreign'), (2, 5, 'text', 'No document')
  `).run();
  const controller = createItemController({ db });
  const foreignRes = createResponse();
  const missingRes = createResponse();

  controller.getDocument({ userId: 5, params: { id: 1 } }, foreignRes);
  controller.getDocument({ userId: 5, params: { id: 2 } }, missingRes);

  assert.equal(foreignRes.statusCode, 404);
  assert.deepEqual(foreignRes.jsonBody, { error: '不存在' });
  assert.equal(missingRes.statusCode, 404);
  assert.deepEqual(missingRes.jsonBody, { error: '文档尚未生成' });
}));

test('reindexDocument rebuilds owned document chunks', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 5, 'file', 'Plan.md', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Plan

## Old

Old text.`);
  indexDocumentForItem(db, 1);
  db.prepare('UPDATE links SET content_md = ? WHERE id = 1').run(`# Plan

## New

New text.`);
  const controller = createItemController({ db });
  const res = createResponse();

  controller.reindexDocument({ userId: 5, params: { id: 1 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.stats.chunk_count, 1);
  assert.equal(res.jsonBody.chunks[0].heading_path, 'Plan.md > New');
  assert.match(res.jsonBody.chunks[0].content, /New text/);
}));

test('rechunkDocument rebuilds chunks from the existing canonical markdown only', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 5, 'file', 'Plan.md', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Plan

## Original

Original text.`);
  indexDocumentForItem(db, 1);
  db.prepare('UPDATE links SET content_md = ? WHERE id = 1').run(`# Plan

## Changed Source

Changed source text.`);
  db.prepare('DELETE FROM document_chunks').run();
  const controller = createItemController({ db });
  const res = createResponse();

  controller.rechunkDocument({ userId: 5, params: { id: 1 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.chunks[0].heading_path, 'Plan.md > Original');
  assert.match(res.jsonBody.chunks[0].content, /Original text/);
}));

test('annotateDocument stores a generated document annotation', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, summary, content_md)
    VALUES (1, 5, 'file', 'Plan.md', '2026-06-11T00:00:00.000Z', 'Short summary', ?)
  `).run(`# Plan

## Section

Important text.`);
  indexDocumentForItem(db, 1);
  const controller = createItemController({ db });
  const res = createResponse();

  controller.annotateDocument({ userId: 5, params: { id: 1 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.annotations.length, 1);
  assert.equal(res.jsonBody.annotations[0].type, 'inspection_summary');
  assert.match(res.jsonBody.annotations[0].content_json, /Short summary/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM document_annotations').get().count, 1);
}));
