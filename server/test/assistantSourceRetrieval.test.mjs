import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDocumentSchema, indexDocumentForItem } from '../utils/documentIndex.js';
import { retrieveAssistantSources } from '../utils/assistantSourceRetrieval.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-assistant-source-retrieval-test-'));
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
      CREATE TABLE link_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL
      );
    `);
    initDocumentSchema(db);
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertItem(db, {
  id,
  userId = 5,
  type = 'file',
  url = '',
  title,
  importedAt = '2026-06-15T00:00:00.000Z',
  contentMd = '',
  summary = '',
}) {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, type, url, title, summary, importedAt, contentMd);
}

function insertLegacyChunk(db, {
  linkId,
  userId = 5,
  chunkIndex = 0,
  text,
}) {
  db.prepare(`
    INSERT INTO link_chunks (link_id, user_id, chunk_index, text)
    VALUES (?, ?, ?, ?)
  `).run(linkId, userId, chunkIndex, text);
}

test('retrieveAssistantSources prefers canonical document chunks over legacy chunks', () => withDb((db) => {
  insertItem(db, {
    id: 1,
    type: 'link',
    url: 'https://legacy.example',
    title: 'Legacy Source',
  });
  insertLegacyChunk(db, {
    linkId: 1,
    text: 'legacy durable queue facts',
  });
  insertItem(db, {
    id: 2,
    title: 'Canonical Queue Notes',
    contentMd: '# Canonical Queue Notes\n\n## Durable Jobs\n\nDurable queue facts from canonical document chunks.',
  });
  indexDocumentForItem(db, 2);

  const sources = retrieveAssistantSources(db, {
    userId: 5,
    question: 'durable queue facts',
    limit: 4,
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourceKind, 'document');
  assert.equal(sources[0].id, 2);
  assert.equal(sources[0].link_id, 2);
  assert.equal(sources[0].heading_path, 'Canonical Queue Notes > Durable Jobs');
  assert.match(sources[0].chunk_text, /canonical document chunks/);
  assert.equal(sources[0].source_index, 1);
  assert.equal(typeof sources[0].score, 'number');
}));

test('retrieveAssistantSources falls back to legacy chunks when no canonical document matches', () => withDb((db) => {
  insertItem(db, {
    id: 1,
    type: 'link',
    url: 'https://legacy.example',
    title: 'Legacy Only',
  });
  insertLegacyChunk(db, {
    linkId: 1,
    text: 'legacy-only retrieval content',
  });

  const sources = retrieveAssistantSources(db, {
    userId: 5,
    question: 'legacy-only retrieval',
    limit: 3,
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourceKind, 'legacy');
  assert.equal(sources[0].id, 1);
  assert.equal(sources[0].link_id, 1);
  assert.match(sources[0].chunk_text, /legacy-only retrieval/);
}));

test('retrieveAssistantSources can suppress legacy fallback', () => withDb((db) => {
  insertItem(db, {
    id: 1,
    type: 'link',
    url: 'https://legacy.example',
    title: 'Legacy Only',
  });
  insertLegacyChunk(db, {
    linkId: 1,
    text: 'legacy-only retrieval content',
  });

  const sources = retrieveAssistantSources(db, {
    userId: 5,
    question: 'legacy-only retrieval',
    limit: 3,
    includeLegacyFallback: false,
  });

  assert.deepEqual(sources, []);
}));
