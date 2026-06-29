import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDocumentSchema, indexDocumentForItem } from '../utils/documentIndex.js';
import { buildRetrievalDiagnostics, retrieveAssistantSources, retrieveAssistantSourcesAsync } from '../utils/assistantSourceRetrieval.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-assistant-source-retrieval-test-'));
  const db = new Database(join(dir, 'test.db'));
  const cleanup = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
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
    const result = fn(db);
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
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

test('retrieveAssistantSources respects environment config that disables legacy fallback', () => withDb((db) => {
  const previous = process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK;
  process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK = '0';
  try {
    insertItem(db, {
      id: 1,
      type: 'link',
      url: 'https://legacy.example',
      title: 'Legacy Only',
    });
    insertLegacyChunk(db, {
      linkId: 1,
      text: 'zephyr-lattice alpha-beta gamma-delta legacy content',
    });
    insertItem(db, {
      id: 2,
      title: 'Canonical Only',
      contentMd: '# Canonical Only\n\n## Canonical\n\norchid-matrix canonical content.',
    });
    indexDocumentForItem(db, 2);

    const legacySources = retrieveAssistantSources(db, {
      userId: 5,
      question: 'zephyr-lattice alpha-beta gamma-delta',
      scope: { type: 'link' },
      limit: 4,
    });
    const canonicalSources = retrieveAssistantSources(db, {
      userId: 5,
      question: 'orchid-matrix',
      limit: 4,
    });

    assert.deepEqual(legacySources, []);
    assert.equal(canonicalSources.length, 1);
    assert.equal(canonicalSources[0].sourceKind, 'document');
    assert.equal(canonicalSources[0].id, 2);
    assert.match(canonicalSources[0].chunk_text, /orchid-matrix/);
  } finally {
    if (previous === undefined) {
      delete process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK;
    } else {
      process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK = previous;
    }
  }
}));

test('retrieveAssistantSources answers latest uploaded file questions from newest item metadata', () => withDb((db) => {
  insertItem(db, {
    id: 1,
    type: 'file',
    title: '旧的项目资料.pdf',
    importedAt: '2026-06-20T08:00:00.000Z',
    summary: '旧文件内容',
  });
  insertItem(db, {
    id: 2,
    type: 'file',
    title: '最新融资需求.pdf',
    importedAt: '2026-06-30T08:30:00.000Z',
    summary: '',
    contentMd: '',
  });

  const sources = retrieveAssistantSources(db, {
    userId: 5,
    question: '我最新发的文件是啥',
    limit: 3,
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourceKind, 'latest_item');
  assert.equal(sources[0].id, 2);
  assert.equal(sources[0].title, '最新融资需求.pdf');
  assert.deepEqual(sources[0].retrieval_modes, ['latest_item']);
}));

test('retrieveAssistantSourcesAsync answers latest uploaded file questions before keyword embeddings', async () => withDb(async (db) => {
  insertItem(db, {
    id: 1,
    type: 'image',
    title: 'IMG_6980.jpeg',
    importedAt: '2026-06-30T08:00:00.000Z',
    contentMd: '我最新发的文件是啥 这几个关键词出现在旧图片里',
  });
  insertItem(db, {
    id: 2,
    type: 'file',
    title: '最新融资需求.pdf',
    importedAt: '2026-06-30T08:30:00.000Z',
    summary: '',
    contentMd: '',
  });

  const sources = await retrieveAssistantSourcesAsync(db, {
    userId: 5,
    question: '我最新发的文件是啥',
    limit: 3,
    enableEmbeddings: true,
    embeddingOptions: {
      embedQuery: async () => [0.1, 0.2],
    },
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourceKind, 'latest_item');
  assert.equal(sources[0].id, 2);
  assert.equal(sources[0].title, '最新融资需求.pdf');
}));

test('buildRetrievalDiagnostics preserves retrieval metadata and snippets', () => {
  const diagnostics = buildRetrievalDiagnostics({
    question: 'durable queue facts',
    task: 'report',
    scope: { type: 'document', since: '2026-06-01' },
    settings: { enabled: true, provider: 'openai', model: 'text-embedding-3-small' },
    sources: [
      {
        id: 10,
        link_id: 10,
        sourceKind: 'document',
        source_index: 3,
        title: 'Queue Notes',
        url: 'https://example.test/queue',
        score: 7,
        combined_score: 12.5,
        embedding_score: 0.91,
        retrieval_modes: ['keyword', 'embedding'],
        rerank_mode: 'local',
        rerank_score: 0.82,
        document_id: 22,
        chunk_id: 44,
        heading_path: 'Queue Notes > Durable Jobs',
        chunk_type: 'section',
        chunk_text: ' Durable queue facts with\nextra whitespace. ',
      },
    ],
  });

  assert.deepEqual(diagnostics, {
    query: 'durable queue facts',
    task: 'report',
    scope: { type: 'document', since: '2026-06-01' },
    settings: { enabled: true, provider: 'openai', model: 'text-embedding-3-small' },
    sources: [
      {
        id: 10,
        link_id: 10,
        sourceKind: 'document',
        source_index: 3,
        title: 'Queue Notes',
        url: 'https://example.test/queue',
        score: 7,
        combined_score: 12.5,
        embedding_score: 0.91,
        retrieval_modes: ['keyword', 'embedding'],
        rerank_mode: 'local',
        rerank_score: 0.82,
        document_id: 22,
        chunk_id: 44,
        heading_path: 'Queue Notes > Durable Jobs',
        chunk_type: 'section',
        snippet: 'Durable queue facts with extra whitespace.',
      },
    ],
  });
});
