import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildCanonicalMarkdown,
  initDocumentSchema,
  indexDocumentForItem,
  searchDocumentChunks,
  splitMarkdownIntoSemanticChunks,
} from '../utils/documentIndex.js';
import {
  embedTextsWithOpenAICompatible,
  indexMissingDocumentEmbeddingsAsync,
  indexMissingDocumentEmbeddings,
  searchEmbeddedDocumentChunks,
} from '../utils/documentEmbeddings.js';

async function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-document-index-test-'));
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
    `);
    initDocumentSchema(db);
    return await fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('buildCanonicalMarkdown wraps item markdown with stable source metadata', () => {
  const markdown = buildCanonicalMarkdown({
    id: 9,
    type: 'link',
    url: 'https://example.com/post',
    title: 'Example Post',
    imported_at: '2026-06-11T10:00:00.000Z',
    content_md: '## Notes\n\nMain body',
  });

  assert.match(markdown, /^---\n/);
  assert.match(markdown, /title: Example Post/);
  assert.match(markdown, /source_type: link/);
  assert.match(markdown, /source_url: https:\/\/example.com\/post/);
  assert.match(markdown, /item_id: 9/);
  assert.match(markdown, /parser: linkbox-canonical-v1/);
  assert.match(markdown, /# Example Post\n\n## Notes\n\nMain body/);
});

test('splitMarkdownIntoSemanticChunks keeps heading paths and chunk types', () => {
  const chunks = splitMarkdownIntoSemanticChunks(`# Root

Intro paragraph.

## First

First body.

| A | B |
| --- | --- |
| 1 | 2 |

## Second

\`\`\`js
console.log('x');
\`\`\`
`);

  assert.deepEqual(chunks.map(chunk => chunk.headingPath), [
    'Root',
    'Root > First',
    'Root > First',
    'Root > Second',
  ]);
  assert.deepEqual(chunks.map(chunk => chunk.chunkType), [
    'text',
    'text',
    'table',
    'code',
  ]);
});

test('indexDocumentForItem upserts one document and heading-aware chunks', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES (1, 5, 'link', 'https://example.com/kb', 'Knowledge Base', 'Short summary', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Knowledge Base

Intro.

## Retrieval

Keyword retrieval details.

## Operations

Queue retry details.`);

  const result = indexDocumentForItem(db, 1);

  assert.equal(result.documentId, 1);
  assert.equal(result.chunkCount, 3);

  const doc = db.prepare('SELECT item_id, user_id, title, parser_version, status FROM documents').get();
  assert.deepEqual(doc, {
    item_id: 1,
    user_id: 5,
    title: 'Knowledge Base',
    parser_version: 'linkbox-canonical-v1',
    status: 'ready',
  });

  const chunks = db.prepare('SELECT chunk_index, heading_path, chunk_type, content FROM document_chunks ORDER BY chunk_index').all();
  assert.deepEqual(chunks.map(chunk => chunk.heading_path), [
    'Knowledge Base',
    'Knowledge Base > Retrieval',
    'Knowledge Base > Operations',
  ]);
  assert.match(chunks[1].content, /Keyword retrieval/);
}));

test('searchDocumentChunks ranks document chunks and returns item metadata', () => withDb((db) => {
  const insert = db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(1, 5, 'link', 'https://example.com/a', 'Ordinary', '', '2026-06-10T00:00:00.000Z', '# Ordinary\n\nGeneral note.');
  insert.run(2, 5, 'file', '', 'Markdown Knowledge Base', 'Plan summary', '2026-06-11T00:00:00.000Z', '# Markdown Knowledge Base\n\n## Retrieval\n\nHybrid keyword retrieval.');
  insert.run(3, 9, 'link', 'https://foreign.example', 'Foreign Knowledge Base', '', '2026-06-12T00:00:00.000Z', '# Foreign Knowledge Base\n\nRetrieval.');
  indexDocumentForItem(db, 1);
  indexDocumentForItem(db, 2);
  indexDocumentForItem(db, 3);

  const results = searchDocumentChunks({ db, userId: 5, query: '知识库 retrieval', limit: 4 });

  assert.equal(results[0].id, 2);
  assert.equal(results[0].document_id, 2);
  assert.equal(results[0].heading_path, 'Markdown Knowledge Base > Retrieval');
  assert.match(results[0].chunk_text, /Hybrid keyword retrieval/);
  assert.ok(results.every(row => row.user_id === 5));
}));

test('indexMissingDocumentEmbeddings stores deterministic vectors for document chunks', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 5, 'file', 'Embedding Plan', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Embedding Plan

## Vector Search

Hybrid retrieval combines keyword and vector candidates.`);
  indexDocumentForItem(db, 1);

  const result = indexMissingDocumentEmbeddings(db);

  assert.deepEqual(result, { indexed: 1, provider: 'local', model: 'linkbox-local-hash-v1' });
  const stored = db.prepare(`
    SELECT e.provider, e.model, e.dimension, e.vector
    FROM document_embeddings e
    JOIN document_chunks c ON c.id = e.chunk_id
  `).get();
  assert.equal(stored.provider, 'local');
  assert.equal(stored.model, 'linkbox-local-hash-v1');
  assert.equal(stored.dimension, 64);
  assert.equal(JSON.parse(stored.vector).length, 64);
}));

test('searchEmbeddedDocumentChunks ranks semantically similar embedded chunks', () => withDb((db) => {
  const insert = db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (?, 5, 'file', ?, ?, ?)
  `);
  insert.run(1, 'Vector Notes', '2026-06-10T00:00:00.000Z', '# Vector Notes\n\n## Embeddings\n\nvector embedding semantic retrieval pipeline');
  insert.run(2, 'Cooking Notes', '2026-06-11T00:00:00.000Z', '# Cooking Notes\n\n## Recipe\n\nsalt sugar butter heat');
  indexDocumentForItem(db, 1);
  indexDocumentForItem(db, 2);
  indexMissingDocumentEmbeddings(db);

  const results = searchEmbeddedDocumentChunks({
    db,
    userId: 5,
    query: 'semantic embedding retrieval',
    limit: 2,
  });

  assert.equal(results[0].id, 1);
  assert.equal(results[0].retrieval_mode, 'embedding');
  assert.ok(results[0].embedding_score > results[1].embedding_score);
}));

test('embedTextsWithOpenAICompatible parses OpenAI-compatible embedding responses', async () => {
  const calls = [];
  const vectors = await embedTextsWithOpenAICompatible(['alpha', 'beta'], {
    baseUrl: 'https://llm.example/v1',
    apiKey: 'secret',
    model: 'embedding-model',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      };
    },
  });

  assert.deepEqual(vectors, [[1, 0], [0, 1]]);
  assert.equal(calls[0].url, 'https://llm.example/v1/embeddings');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'embedding-model',
    input: ['alpha', 'beta'],
  });
});

test('indexMissingDocumentEmbeddings falls back to local vectors when provider fails', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 5, 'file', 'Fallback Embeddings', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Fallback

semantic fallback text`);
  indexDocumentForItem(db, 1);

  const result = indexMissingDocumentEmbeddings(db, {
    provider: 'openai-compatible',
    model: 'remote-embedding',
    dimension: 2,
    embedder: () => {
      throw new Error('network down');
    },
  });

  assert.equal(result.indexed, 1);
  assert.equal(result.provider, 'local');
  assert.equal(result.error, 'network down');
  const stored = db.prepare('SELECT provider, model, dimension FROM document_embeddings').get();
  assert.equal(stored.provider, 'local');
  assert.equal(stored.model, 'linkbox-local-hash-v1');
  assert.equal(stored.dimension, 64);
}));

test('indexMissingDocumentEmbeddingsAsync stores remote OpenAI-compatible vectors', async () => withDb(async (db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 5, 'file', 'Remote Embeddings', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Remote Embeddings

semantic remote vector text`);
  indexDocumentForItem(db, 1);

  const result = await indexMissingDocumentEmbeddingsAsync(db, {
    provider: 'openai-compatible',
    model: 'remote-embedding',
    embedder: async (texts) => texts.map((_text, index) => index === 0 ? [0.25, 0.75] : [0.75, 0.25]),
  });

  assert.equal(result.indexed, 1);
  assert.equal(result.provider, 'openai-compatible');
  assert.equal(result.model, 'remote-embedding');
  const stored = db.prepare('SELECT provider, model, dimension, vector FROM document_embeddings').get();
  assert.equal(stored.provider, 'openai-compatible');
  assert.equal(stored.model, 'remote-embedding');
  assert.equal(stored.dimension, 2);
  assert.deepEqual(JSON.parse(stored.vector), [0.25, 0.75]);
}));
