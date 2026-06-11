import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDocumentSchema, indexDocumentForItem } from '../utils/documentIndex.js';
import { retrieveSources } from '../utils/assistantRetrieval.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-assistant-retrieval-test-'));
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

test('retrieveSources prefers document chunks with heading paths over legacy chunks', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES
      (1, 5, 'link', 'https://legacy.example', 'Legacy Source', '', '2026-06-10T00:00:00.000Z', '# Legacy Source\\n\\nold keyword text'),
      (2, 5, 'file', '', 'Knowledge Base Plan', 'Document summary', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Knowledge Base Plan

## Retrieval Strategy

Hybrid keyword retrieval from canonical Markdown documents.`);
  db.prepare(`
    INSERT INTO link_chunks (link_id, user_id, chunk_index, text)
    VALUES (1, 5, 0, 'legacy retrieval text')
  `).run();
  indexDocumentForItem(db, 2);

  const sources = retrieveSources({
    db,
    userId: 5,
    question: 'retrieval strategy',
    task: 'ask',
    maxSources: 4,
  });

  assert.equal(sources[0].id, 2);
  assert.ok(sources[0].document_id);
  assert.equal(sources[0].heading_path, 'Knowledge Base Plan > Retrieval Strategy');
  assert.match(sources[0].chunk_text, /canonical Markdown/);
}));

test('retrieveSources can merge embedding candidates when hybrid retrieval is enabled', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES
      (1, 5, 'file', '', 'Keyword Match', '', '2026-06-10T00:00:00.000Z', '# Keyword Match\\n\\n## Notes\\n\\nkeyword-only exact phrase'),
      (2, 5, 'file', '', 'Vector Match', '', '2026-06-11T00:00:00.000Z', '# Vector Match\\n\\n## Embeddings\\n\\nsemantic embedding retrieval pipeline')
  `).run();
  indexDocumentForItem(db, 1);
  indexDocumentForItem(db, 2);

  const sources = retrieveSources({
    db,
    userId: 5,
    question: 'semantic embedding retrieval keyword-only',
    task: 'ask',
    maxSources: 4,
    enableEmbeddings: true,
  });

  assert.deepEqual(sources.map(source => source.id), [2, 1]);
  assert.ok(sources.every(source => source.source_index));
}));

test('retrieveSources reranks merged candidates without dropping source metadata', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES
      (1, 5, 'file', '', 'General Notes', '', '2026-06-11T00:00:00.000Z', ?),
      (2, 5, 'file', '', 'Knowledge Base', '', '2026-06-10T00:00:00.000Z', ?)
  `).run(
    '# General Notes\n\n## Misc\n\nretrieval appears once in a long unrelated paragraph',
    '# Knowledge Base\n\n## Retrieval Strategy\n\nHybrid retrieval strategy uses document chunks and citations.',
  );
  indexDocumentForItem(db, 1);
  indexDocumentForItem(db, 2);

  const sources = retrieveSources({
    db,
    userId: 5,
    question: 'retrieval strategy',
    task: 'ask',
    maxSources: 2,
    enableEmbeddings: true,
    enableRerank: true,
  });

  assert.equal(sources[0].id, 2);
  assert.equal(sources[0].source_index, 1);
  assert.equal(sources[0].rerank_mode, 'local');
  assert.ok(sources[0].chunk_id);
  assert.match(sources[0].chunk_text, /Hybrid retrieval strategy/);
}));
