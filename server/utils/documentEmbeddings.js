import { createHash } from 'crypto';
import { initDocumentSchema } from './documentIndex.js';
import { scoreTextFields, tokenizeQuery } from './chunkIndex.js';
import { sqlConditionForItemKind } from './itemKind.js';
import { addTimeScopeConditions } from './timeScope.js';

export const LOCAL_EMBEDDING_PROVIDER = 'local';
export const LOCAL_EMBEDDING_MODEL = 'linkbox-local-hash-v1';
export const LOCAL_EMBEDDING_DIMENSION = 64;

function hashToken(token) {
  const hash = createHash('sha256').update(token).digest();
  return hash.readUInt32BE(0);
}

function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map(value => Number((value / norm).toFixed(8)));
}

export function embedTextLocally(text, dimension = LOCAL_EMBEDDING_DIMENSION) {
  const vector = Array.from({ length: dimension }, () => 0);
  const tokens = tokenizeQuery(text);
  for (const token of tokens) {
    const bucket = hashToken(token) % dimension;
    vector[bucket] += 1;
  }
  return normalizeVector(vector);
}

function dotProduct(left, right) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let i = 0; i < length; i += 1) score += left[i] * right[i];
  return score;
}

function parseVector(raw) {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(Number) : [];
  } catch {
    return [];
  }
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

export async function embedTextsWithOpenAICompatible(texts, {
  baseUrl,
  apiKey = '',
  model,
  fetchImpl = fetch,
  timeoutMs = 30000,
} = {}) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/embeddings`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const err = await response.text?.().catch(() => '');
    throw new Error(`Embedding error ${response.status}: ${String(err || '').slice(0, 160)}`);
  }
  const data = await response.json();
  const ordered = [...(Array.isArray(data.data) ? data.data : [])]
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .map(item => item.embedding)
    .filter(vector => Array.isArray(vector));
  if (ordered.length !== texts.length) {
    throw new Error('Embedding response size mismatch');
  }
  return ordered.map(vector => normalizeVector(vector.map(Number)));
}

function resolveRemoteEmbeddingConfig({ provider, model, dimension, embeddingConfig = {} }) {
  if (provider !== 'openai-compatible') return null;
  return {
    baseUrl: embeddingConfig.baseUrl || process.env.EMBEDDING_BASE_URL || 'http://localhost:8000/v1',
    apiKey: embeddingConfig.apiKey ?? process.env.EMBEDDING_API_KEY ?? '',
    model: model || embeddingConfig.model || process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    dimension,
  };
}

function localEmbeddingResult(rows) {
  const texts = rows.map(row => `${row.heading_path}\n${row.content}`);
  return {
    provider: LOCAL_EMBEDDING_PROVIDER,
    model: LOCAL_EMBEDDING_MODEL,
    dimension: LOCAL_EMBEDDING_DIMENSION,
    vectors: texts.map(text => embedTextLocally(text)),
  };
}

function embeddingText(row) {
  return `${row.heading_path}\n${row.content}`;
}

function embedRowsSync(rows, options) {
  const remote = resolveRemoteEmbeddingConfig(options);
  if (!remote) return localEmbeddingResult(rows);
  if (!options.embedder) throw new Error('Async embedding providers require indexMissingDocumentEmbeddingsAsync');

  const texts = rows.map(embeddingText);
  const vectors = options.embedder(texts, remote);
  if (typeof vectors?.then === 'function') {
    throw new Error('Async embedding providers require indexMissingDocumentEmbeddingsAsync');
  }
  return {
    provider: options.provider,
    model: remote.model,
    dimension: vectors[0]?.length || remote.dimension || 0,
    vectors,
  };
}

async function embedRowsAsync(rows, options) {
  const remote = resolveRemoteEmbeddingConfig(options);
  if (!remote) return localEmbeddingResult(rows);

  const texts = rows.map(embeddingText);
  const embedder = options.embedder || embedTextsWithOpenAICompatible;
  const vectors = await embedder(texts, remote);
  return {
    provider: options.provider,
    model: remote.model,
    dimension: vectors[0]?.length || remote.dimension || 0,
    vectors,
  };
}

export function indexMissingDocumentEmbeddings(
  db,
  {
    provider = LOCAL_EMBEDDING_PROVIDER,
    model = LOCAL_EMBEDDING_MODEL,
    dimension = LOCAL_EMBEDDING_DIMENSION,
    limit = 500,
    embedder,
    embeddingConfig,
  } = {},
) {
  if (!db) throw new Error('indexMissingDocumentEmbeddings requires a database');
  initDocumentSchema(db);
  const rows = db.prepare(`
    SELECT c.id, c.content, c.heading_path, c.content_hash
    FROM document_chunks c
    LEFT JOIN document_embeddings e
      ON e.chunk_id = c.id
      AND e.provider = ?
      AND e.model = ?
      AND e.content_hash = c.content_hash
    WHERE e.id IS NULL
    ORDER BY c.id ASC
    LIMIT ?
  `).all(provider, model, limit);
  if (!rows.length) return { indexed: 0, provider, model };

  const insert = db.prepare(`
    INSERT INTO document_embeddings (chunk_id, provider, model, dimension, vector, content_hash)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
      dimension = excluded.dimension,
      vector = excluded.vector,
      content_hash = excluded.content_hash,
      created_at = datetime('now')
  `);

  let embedded;
  let error = '';
  try {
    embedded = embedRowsSync(rows, { provider, model, dimension, embedder, embeddingConfig });
  } catch (err) {
    error = err.message || String(err);
    embedded = localEmbeddingResult(rows);
  }

  const tx = db.transaction(() => {
    rows.forEach((row, index) => {
      insert.run(
        row.id,
        embedded.provider,
        embedded.model,
        embedded.dimension,
        JSON.stringify(embedded.vectors[index]),
        row.content_hash,
      );
    });
  });
  tx();

  return { indexed: rows.length, provider: embedded.provider, model: embedded.model, ...(error ? { error } : {}) };
}

export async function indexMissingDocumentEmbeddingsAsync(
  db,
  {
    provider = process.env.EMBEDDING_PROVIDER || LOCAL_EMBEDDING_PROVIDER,
    model = process.env.EMBEDDING_MODEL || LOCAL_EMBEDDING_MODEL,
    dimension = LOCAL_EMBEDDING_DIMENSION,
    limit = 500,
    embedder,
    embeddingConfig,
  } = {},
) {
  if (!db) throw new Error('indexMissingDocumentEmbeddingsAsync requires a database');
  initDocumentSchema(db);
  const rows = db.prepare(`
    SELECT c.id, c.content, c.heading_path, c.content_hash
    FROM document_chunks c
    LEFT JOIN document_embeddings e
      ON e.chunk_id = c.id
      AND e.provider = ?
      AND e.model = ?
      AND e.content_hash = c.content_hash
    WHERE e.id IS NULL
    ORDER BY c.id ASC
    LIMIT ?
  `).all(provider, model, limit);
  if (!rows.length) return { indexed: 0, provider, model };

  let embedded;
  let error = '';
  try {
    embedded = await embedRowsAsync(rows, { provider, model, dimension, embedder, embeddingConfig });
  } catch (err) {
    error = err.message || String(err);
    embedded = localEmbeddingResult(rows);
  }

  const insert = db.prepare(`
    INSERT INTO document_embeddings (chunk_id, provider, model, dimension, vector, content_hash)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
      dimension = excluded.dimension,
      vector = excluded.vector,
      content_hash = excluded.content_hash,
      created_at = datetime('now')
  `);
  const tx = db.transaction(() => {
    rows.forEach((row, index) => {
      insert.run(row.id, embedded.provider, embedded.model, embedded.dimension, JSON.stringify(embedded.vectors[index]), row.content_hash);
    });
  });
  tx();

  return { indexed: rows.length, provider: embedded.provider, model: embedded.model, ...(error ? { error } : {}) };
}

function linksHasScopeColumn(db) {
  return db.prepare('PRAGMA table_info(links)').all().some(column => column.name === 'scope');
}

function scopeConditions({ db, scope, params }) {
  const conditions = ['d.user_id = ?'];
  const hasScopeColumn = scope.hasScopeColumn !== undefined
    ? scope.hasScopeColumn
    : linksHasScopeColumn(db);
  if (hasScopeColumn !== false) conditions.push("COALESCE(l.scope, 'personal') = 'personal'");
  conditions.push(...addTimeScopeConditions(scope, params, 'l.imported_at'));
  if (scope.type) {
    const condition = sqlConditionForItemKind(scope.type, 'l');
    conditions.push(condition.sql);
    params.push(...condition.params);
  }
  return conditions;
}

function keywordTieBreakScore(row, tokens) {
  return scoreTextFields(row, tokens, {
    title: 8,
    summary: 4,
    heading_path: 6,
    content: 1,
  });
}

export function searchEmbeddedDocumentChunks({
  db,
  userId,
  query,
  limit = 12,
  scope = {},
  provider = LOCAL_EMBEDDING_PROVIDER,
  model = LOCAL_EMBEDDING_MODEL,
} = {}) {
  if (!db) throw new Error('searchEmbeddedDocumentChunks requires a database');
  initDocumentSchema(db);
  indexMissingDocumentEmbeddings(db, { provider, model });

  const queryVector = embedTextLocally(query);
  const rows = embeddedRowsForSearch({ db, userId, scope, provider, model });
  return rankEmbeddedRows(rows, queryVector, query, limit);
}

async function embedQueryAsync(query, options) {
  const remote = resolveRemoteEmbeddingConfig(options);
  if (!remote) return embedTextLocally(query);
  const embedder = options.embedder || embedTextsWithOpenAICompatible;
  const vectors = await embedder([query], remote);
  return vectors[0] || [];
}

function rankEmbeddedRows(rows, queryVector, query, limit) {
  const tokens = tokenizeQuery(query);
  return rows
    .map(row => {
      const embeddingScore = dotProduct(queryVector, parseVector(row.vector));
      return {
        ...row,
        retrieval_mode: 'embedding',
        embedding_score: embeddingScore,
        score: embeddingScore * 100 + keywordTieBreakScore(row, tokens),
      };
    })
    .filter(row => row.embedding_score > 0)
    .sort((a, b) => b.score - a.score || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, limit);
}

function embeddedRowsForSearch({ db, userId, scope, provider, model }) {
  const params = [userId, provider, model];
  const conditions = scopeConditions({ db, scope, params });
  return db.prepare(`
    SELECT
      c.id AS chunk_id,
      c.chunk_index,
      c.heading_path,
      c.chunk_type,
      c.content AS chunk_text,
      c.content,
      d.id AS document_id,
      d.user_id,
      l.id,
      l.type,
      l.url,
      l.title,
      l.summary,
      l.comment,
      l.imported_at,
      e.vector
    FROM document_embeddings e
    JOIN document_chunks c ON c.id = e.chunk_id
    JOIN documents d ON d.id = c.document_id
    JOIN links l ON l.id = d.item_id
    WHERE ${conditions.join(' AND ')}
      AND e.provider = ?
      AND e.model = ?
    ORDER BY l.imported_at DESC, c.chunk_index ASC
    LIMIT 2000
  `).all(...params);
}

export async function searchEmbeddedDocumentChunksAsync({
  db,
  userId,
  query,
  limit = 12,
  scope = {},
  provider = process.env.EMBEDDING_PROVIDER || LOCAL_EMBEDDING_PROVIDER,
  model = process.env.EMBEDDING_MODEL || LOCAL_EMBEDDING_MODEL,
  dimension = LOCAL_EMBEDDING_DIMENSION,
  embedder,
  embeddingConfig,
} = {}) {
  if (!db) throw new Error('searchEmbeddedDocumentChunksAsync requires a database');
  initDocumentSchema(db);
  await indexMissingDocumentEmbeddingsAsync(db, { provider, model, dimension, embedder, embeddingConfig });
  const queryVector = await embedQueryAsync(query, { provider, model, dimension, embedder, embeddingConfig });
  const rows = embeddedRowsForSearch({ db, userId, scope, provider, model });
  return rankEmbeddedRows(rows, queryVector, query, limit);
}
