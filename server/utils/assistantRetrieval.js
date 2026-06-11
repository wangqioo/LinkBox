import defaultDb from '../db.js';
import { indexAllMissingChunks, scoreTextFields, searchRelevantChunks, tokenizeQuery } from './chunkIndex.js';
import { indexAllMissingDocuments, searchDocumentChunks } from './documentIndex.js';
import { searchEmbeddedDocumentChunks } from './documentEmbeddings.js';
import { rerankDocumentCandidates } from './documentRerank.js';
import { addTimeScopeConditions, normalizeTimeScope, resolveTimeScope } from './timeScope.js';

const DEFAULT_MAX_SOURCES = Number(process.env.ASSISTANT_MAX_SOURCES || 8);
const DEFAULT_MAX_FALLBACK_SOURCES = Number(process.env.ASSISTANT_MAX_FALLBACK_SOURCES || 2);

function tokenize(text) {
  return tokenizeQuery(text);
}

function scoreItem(item, tokens) {
  let score = scoreTextFields(item, tokens, {
    title: 8,
    summary: 5,
    comment: 4,
    url: 3,
    content_md: 1,
    content: 1,
  });

  if (item.summary) score += 1;
  if (item.content_md) score += 1;
  return score;
}

function shouldUseFallbackSources(task, question) {
  if (task === 'ask') return false;
  if (task === 'recent') return true;
  return tokenize(question).length < 2;
}

function normalizeScope(scope = {}) {
  const type = String(scope.type || '').trim();
  return {
    ...normalizeTimeScope(scope),
    type: type === 'document' ? 'file' : type,
  };
}

function scopeWhere(scope, params) {
  const conditions = addTimeScopeConditions(scope, params, 'l.imported_at');
  if (scope.type) {
    conditions.push('l.type = ?');
    params.push(scope.type);
  }
  return conditions;
}

function chunkDedupeKey(item) {
  return item.document_id && item.chunk_index !== undefined
    ? `document:${item.document_id}:chunk:${item.chunk_index}`
    : `item:${item.id}:chunk:${item.chunk_id || item.id}`;
}

function mergeRetrievalCandidates(keywordRows, embeddingRows, limit) {
  const byKey = new Map();

  for (const row of keywordRows) {
    byKey.set(chunkDedupeKey(row), {
      ...row,
      retrieval_mode: row.retrieval_mode || 'keyword',
      retrieval_modes: ['keyword'],
      combined_score: Number(row.score || 0),
    });
  }

  for (const row of embeddingRows) {
    const key = chunkDedupeKey(row);
    const existing = byKey.get(key);
    if (existing) {
      existing.retrieval_modes = [...new Set([...existing.retrieval_modes, 'embedding'])];
      existing.embedding_score = row.embedding_score;
      existing.combined_score += Number(row.score || 0);
      continue;
    }
    byKey.set(key, {
      ...row,
      retrieval_modes: ['embedding'],
      combined_score: Number(row.score || 0),
    });
  }

  return [...byKey.values()]
    .sort((a, b) => b.combined_score - a.combined_score || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, limit);
}

export function retrieveSources({
  db = defaultDb,
  userId,
  question,
  task = 'ask',
  scope: rawScope = {},
  maxSources = DEFAULT_MAX_SOURCES,
  maxFallbackSources = DEFAULT_MAX_FALLBACK_SOURCES,
  enableEmbeddings = process.env.ASSISTANT_ENABLE_EMBEDDINGS === '1',
  enableRerank = process.env.ASSISTANT_ENABLE_RERANK !== '0',
  now = new Date(),
} = {}) {
  indexAllMissingDocuments(db);
  const scope = normalizeScope({
    ...rawScope,
    ...resolveTimeScope({ question, scope: rawScope, now }),
  });
  const documentChunks = searchDocumentChunks({ db, userId, query: question, task, limit: maxSources, scope });
  const embeddingChunks = enableEmbeddings
    ? searchEmbeddedDocumentChunks({ db, userId, query: question, limit: maxSources, scope })
    : [];
  if (documentChunks.length || embeddingChunks.length) {
    const merged = enableEmbeddings
      ? mergeRetrievalCandidates(documentChunks, embeddingChunks, maxSources)
      : documentChunks;
    const reranked = enableRerank
      ? rerankDocumentCandidates(merged, { query: question, limit: maxSources })
      : merged;
    return reranked.map((item, index) => ({ ...item, source_index: index + 1 }));
  }

  indexAllMissingChunks();
  const chunks = searchRelevantChunks({ userId, query: question, task, limit: maxSources, scope });
  if (chunks.length) {
    return chunks.map((item, index) => ({ ...item, source_index: index + 1 }));
  }

  const params = [userId];
  const scopedConditions = scopeWhere(scope, params);
  const rows = db.prepare(`
    SELECT id, type, url, title, description, comment, content, content_md, summary, imported_at
    FROM links l
    WHERE l.user_id = ?
      AND (
        COALESCE(l.content_md, '') != ''
        OR COALESCE(l.summary, '') != ''
        OR COALESCE(l.content, '') != ''
        OR COALESCE(l.title, '') != ''
      )
      ${scopedConditions.length ? `AND ${scopedConditions.join(' AND ')}` : ''}
    ORDER BY l.imported_at DESC
    LIMIT 1000
  `).all(...params);

  if (task === 'recent') {
    return rows.slice(0, maxSources).map((item, index) => ({ ...item, source_index: index + 1 }));
  }

  const tokens = tokenize(question);
  const ranked = rows
    .map(item => ({ ...item, score: scoreItem(item, tokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, maxSources)
    .map((item, index) => ({ ...item, source_index: index + 1 }));

  if (ranked.length) return ranked;
  if (!shouldUseFallbackSources(task, question)) return [];
  return rows.slice(0, maxFallbackSources).map((item, index) => ({ ...item, source_index: index + 1 }));
}
