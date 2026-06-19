import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initJobSchema } from '../utils/jobQueue.js';
import { persistExtractedContent } from '../utils/extractedContentPersistence.js';
import { initItemAssetSchema } from '../utils/itemAssetStore.js';
import { initItemContentSchema } from '../utils/itemContentStore.js';

async function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-extracted-content-test-'));
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
    initItemContentSchema(db);
    initItemAssetSchema(db);
    db.prepare("INSERT INTO links (id, user_id, type, title) VALUES (1, 5, 'link', 'Article')").run();
    return await fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('persistExtractedContent stores markdown and schedules summary work', () => withDb((db) => {
  const indexed = [];
  const documents = [];
  const jobs = [];
  const queue = { enqueue: (type, options) => jobs.push({ type, options }) };

  persistExtractedContent(db, queue, {
    linkId: 1,
    markdown: '# Extracted\n\nBody',
    indexLink: linkId => indexed.push(linkId),
    indexDocument: (database, linkId) => {
      documents.push(linkId);
      assert.equal(database, db);
      return { documentId: 10 };
    },
  });

  const row = db.prepare('SELECT content_md, status FROM links WHERE id = 1').get();
  assert.equal(row.content_md, '# Extracted\n\nBody');
  assert.equal(row.status, '');
  assert.equal(
    db.prepare('SELECT extracted_markdown FROM item_content WHERE item_id = 1').get().extracted_markdown,
    '# Extracted\n\nBody',
  );
  assert.deepEqual(indexed, [1]);
  assert.deepEqual(documents, [1]);
  assert.deepEqual(jobs.map(job => job.type), ['document.embed', 'link.summarize']);
}));

test('persistExtractedContent stores raw html and thumbnail for file extraction', () => withDb((db) => {
  const jobs = [];
  const queue = { enqueue: (...args) => jobs.push(args) };

  const result = persistExtractedContent(db, queue, {
    linkId: 1,
    markdown: '![slide](/uploads/slide.png)',
    rawHtml: '<h1>Original</h1>',
    thumbnail: '/uploads/slide.png',
    summarize: false,
    indexLink: () => {},
    indexDocument: () => ({ documentId: null }),
  });

  const row = db.prepare('SELECT html_note, thumbnail FROM links WHERE id = 1').get();
  assert.equal(row.html_note, '<h1>Original</h1>');
  assert.equal(row.thumbnail, '/uploads/slide.png');
  assert.equal(db.prepare('SELECT html_note FROM item_content WHERE item_id = 1').get().html_note, '<h1>Original</h1>');
  assert.deepEqual(
    db.prepare('SELECT kind, public_path FROM item_assets WHERE item_id = 1').get(),
    { kind: 'thumbnail', public_path: '/uploads/slide.png' },
  );
  assert.equal(result.summaryQueued, false);
  assert.deepEqual(jobs, []);
}));

test('persistExtractedContent marks empty extraction done without summary job', () => withDb((db) => {
  const jobs = [];

  const result = persistExtractedContent(db, { enqueue: (...args) => jobs.push(args) }, {
    linkId: 1,
    markdown: '',
  });

  const row = db.prepare('SELECT status FROM links WHERE id = 1').get();
  assert.equal(row.status, 'done');
  assert.equal(result.stored, false);
  assert.deepEqual(jobs, []);
}));

test('persistExtractedContent preserves raw html when extracted markdown is empty', () => withDb((db) => {
  const jobs = [];

  const result = persistExtractedContent(db, { enqueue: (...args) => jobs.push(args) }, {
    linkId: 1,
    markdown: '',
    rawHtml: '<article>Original</article>',
  });

  const row = db.prepare('SELECT html_note, status FROM links WHERE id = 1').get();
  assert.equal(row.html_note, '<article>Original</article>');
  assert.equal(row.status, 'done');
  assert.equal(db.prepare('SELECT html_note FROM item_content WHERE item_id = 1').get().html_note, '<article>Original</article>');
  assert.equal(result.stored, false);
  assert.deepEqual(jobs, []);
}));

test('persistExtractedContent can skip summary work without a queue', () => withDb((db) => {
  const result = persistExtractedContent(db, null, {
    linkId: 1,
    markdown: '# Manual extraction',
    summarize: false,
    indexLink: () => {},
    indexDocument: () => ({ documentId: 10 }),
  });

  assert.equal(result.stored, true);
  assert.equal(result.summaryQueued, false);
}));

test('persistExtractedContent supports link tables without optional columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-extracted-content-minimal-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        content_md TEXT DEFAULT '',
        status TEXT DEFAULT ''
      );
    `);
    db.prepare('INSERT INTO links (id, user_id) VALUES (1, 5)').run();

    persistExtractedContent(db, null, {
      linkId: 1,
      markdown: '# Minimal schema',
      summarize: false,
      indexLink: () => {},
      indexDocument: () => ({ documentId: null }),
    });

    assert.equal(db.prepare('SELECT content_md FROM links WHERE id = 1').get().content_md, '# Minimal schema');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
