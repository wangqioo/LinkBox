import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDocumentSchema, indexDocumentForItem } from '../utils/documentIndex.js';
import { indexMissingDocumentEmbeddingsAsync } from '../utils/documentEmbeddings.js';
import { retrieveSources, retrieveSourcesAsync } from '../utils/assistantRetrieval.js';
import { upsertItemUnderstanding } from '../utils/itemUnderstanding.js';

async function withDb(fn) {
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
    return await fn(db);
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

test('retrieveSources can disable legacy fallback with environment config', () => withDb((db) => {
  const previous = process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK;
  process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK = '0';
  try {
    db.prepare(`
      INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
      VALUES (1, 5, 'link', 'https://legacy.example', 'Legacy Only', '', '2026-06-10T00:00:00.000Z', '')
    `).run();
    db.prepare(`
      INSERT INTO link_chunks (link_id, user_id, chunk_index, text)
      VALUES (1, 5, 0, 'zephyr-lattice alpha-beta gamma-delta legacy content')
    `).run();
    const legacySources = retrieveSources({
      db,
      userId: 5,
      question: 'zephyr-lattice alpha-beta gamma-delta',
      task: 'ask',
      maxSources: 4,
    });

    assert.deepEqual(legacySources, []);
  } finally {
    if (previous === undefined) {
      delete process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK;
    } else {
      process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK = previous;
    }
  }
}));

test('retrieveSources falls back to structured item understanding evidence', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, comment, imported_at, content_md)
    VALUES (1, 5, 'file', '', 'Agent Roadmap', '', 'TODO: add memory diagnostics', '2026-06-11T00:00:00.000Z', '')
  `).run();
  upsertItemUnderstanding(db, 1);

  const sources = retrieveSources({
    db,
    userId: 5,
    question: 'memory diagnostics',
    task: 'ask',
    maxSources: 4,
    includeLegacyFallback: false,
  });

  assert.equal(sources.length >= 1, true);
  assert.equal(sources[0].sourceKind, 'structured_knowledge');
  assert.equal(sources[0].retrieval_modes.includes('structured'), true);
  assert.match(sources[0].chunk_text, /memory diagnostics/);
}));

test('retrieveSources disables row-level legacy fallback with environment config', () => withDb((db) => {
  const previous = process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK;
  process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK = '0';
  try {
    db.prepare(`
      INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
      VALUES (1, 5, 'link', 'https://legacy.example', 'zephyr-lattice Legacy Row', '', '2026-06-10T00:00:00.000Z', '')
    `).run();

    const sources = retrieveSources({
      db,
      userId: 5,
      question: 'zephyr-lattice',
      task: 'ask',
      maxSources: 4,
    });

    assert.deepEqual(sources, []);
  } finally {
    if (previous === undefined) {
      delete process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK;
    } else {
      process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK = previous;
    }
  }
}));

test('retrieveSources still returns canonical document chunks when environment config disables legacy fallback', () => withDb((db) => {
  const previous = process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK;
  process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK = '0';
  try {
    db.prepare(`
      INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
      VALUES (2, 5, 'file', '', 'Canonical Only', '', '2026-06-11T00:00:00.000Z', ?)
    `).run(`# Canonical Only

## Canonical

orchid-matrix canonical content`);
    indexDocumentForItem(db, 2);

    const canonicalSources = retrieveSources({
      db,
      userId: 5,
      question: 'orchid-matrix',
      task: 'ask',
      maxSources: 4,
    });

    assert.equal(canonicalSources.length, 1);
    assert.equal(canonicalSources[0].id, 2);
    assert.ok(canonicalSources[0].document_id);
    assert.match(canonicalSources[0].chunk_text, /orchid-matrix/);
  } finally {
    if (previous === undefined) {
      delete process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK;
    } else {
      process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK = previous;
    }
  }
}));

test('retrieveSources applies normalized video scope to legacy chunk fallback', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES
      (1, 5, 'link', 'https://b23.tv/abc123', 'Video Legacy', '', '2026-06-10T00:00:00.000Z', ''),
      (2, 5, 'link', 'https://example.com/plain', 'Plain Legacy', '', '2026-06-11T00:00:00.000Z', '')
  `).run();
  db.prepare(`
    INSERT INTO link_chunks (link_id, user_id, chunk_index, text)
    VALUES
      (1, 5, 0, 'hamburger transcript legacy chunk'),
      (2, 5, 0, 'hamburger plain legacy chunk')
  `).run();

  const sources = retrieveSources({
    db,
    userId: 5,
    question: 'hamburger legacy',
    task: 'ask',
    scope: { type: 'video' },
    maxSources: 4,
  });

  assert.deepEqual(sources.map(source => source.id), [1]);
}));

test('retrieveSources applies normalized video scope to row-level fallback', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES
      (1, 5, 'link', 'https://www.bilibili.com/video/BV1GDjB66EE9/', 'Video Row', 'hamburger row summary', '2026-06-10T00:00:00.000Z', ''),
      (2, 5, 'link', 'https://example.com/plain', 'Plain Row', 'hamburger row summary', '2026-06-11T00:00:00.000Z', '')
  `).run();

  const sources = retrieveSources({
    db,
    userId: 5,
    question: 'hamburger',
    task: 'ask',
    scope: { type: 'video' },
    maxSources: 4,
  });

  assert.deepEqual(sources.map(source => source.id), [1]);
}));

test('retrieveSources can merge embedding candidates when hybrid retrieval is enabled', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES
      (1, 5, 'file', '', 'Keyword Match', '', '2026-06-10T00:00:00.000Z', ?),
      (2, 5, 'file', '', 'Vector Match', '', '2026-06-11T00:00:00.000Z', ?)
  `).run(
    '# Keyword Match\n\n## Notes\n\nkeyword-only exact phrase',
    '# Vector Match\n\n## Embeddings\n\nsemantic embedding retrieval pipeline',
  );
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
  assert.equal(sources[0].retrieval_modes.includes('embedding'), true);
  assert.equal(sources[1].retrieval_modes.includes('keyword'), true);
  assert.ok(sources.every(source => source.source_index));
}));

test('retrieveSources returns embedding candidates when keyword retrieval has no matches', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES (1, 5, 'file', '', 'Vector Only Notes', '', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Vector Only Notes

## Embeddings

semantic embedding retrieval pipeline`);
  indexDocumentForItem(db, 1);

  const sources = retrieveSources({
    db,
    userId: 5,
    question: 'conceptual lookup',
    task: 'ask',
    maxSources: 4,
    enableEmbeddings: true,
    enableRerank: false,
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, 1);
  assert.deepEqual(sources[0].retrieval_modes, ['embedding']);
  assert.equal(sources[0].source_index, 1);
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

test('retrieveSources infers natural-language time ranges from the question', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES
      (1, 5, 'file', '', 'Older AI Notes', '', '2026-06-10T08:00:00.000Z', ?),
      (2, 5, 'file', '', 'Yesterday AI Notes', '', '2026-06-11T09:00:00.000Z', ?)
  `).run(
    '# Older AI Notes\n\n## AI\n\nolder artificial intelligence notes',
    '# Yesterday AI Notes\n\n## AI\n\nyesterday artificial intelligence notes',
  );
  indexDocumentForItem(db, 1);
  indexDocumentForItem(db, 2);

  const sources = retrieveSources({
    db,
    userId: 5,
    question: '昨天的 AI 资料',
    task: 'ask',
    maxSources: 4,
    now: new Date('2026-06-12T10:00:00+08:00'),
  });

  assert.deepEqual(sources.map(source => source.id), [2]);
}));

test('retrieveSourcesAsync uses remote embedding query candidates', async () => withDb(async (db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES
      (1, 5, 'file', '', 'Remote Alpha', '', '2026-06-10T00:00:00.000Z', ?),
      (2, 5, 'file', '', 'Remote Beta', '', '2026-06-11T00:00:00.000Z', ?)
  `).run(
    '# Remote Alpha\n\nalpha remote body',
    '# Remote Beta\n\nbeta remote body',
  );
  indexDocumentForItem(db, 1);
  indexDocumentForItem(db, 2);
  const vectorsByText = new Map([
    ['Remote Alpha\nalpha remote body', [1, 0]],
    ['Remote Beta\nbeta remote body', [0, 1]],
    ['find beta', [0, 1]],
  ]);
  const embedder = async (texts) => texts.map(text => vectorsByText.get(text) || [0, 0]);
  await indexMissingDocumentEmbeddingsAsync(db, {
    provider: 'openai-compatible',
    model: 'remote-embedding',
    embedder,
  });

  const sources = await retrieveSourcesAsync({
    db,
    userId: 5,
    question: 'find beta',
    task: 'ask',
    maxSources: 4,
    enableEmbeddings: true,
    enableRerank: false,
    embeddingOptions: {
      provider: 'openai-compatible',
      model: 'remote-embedding',
      embedder,
    },
  });

  assert.equal(sources[0].id, 2);
  assert.equal(sources[0].retrieval_modes.includes('embedding'), true);
  assert.equal(sources[0].embedding_score, 1);
}));
