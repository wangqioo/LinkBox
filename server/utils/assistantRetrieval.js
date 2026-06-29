import defaultDb from '../db.js';
import { indexAllMissingChunks, scoreTextFields, searchRelevantChunks, tokenizeQuery } from './chunkIndex.js';
import { indexAllMissingDocuments, searchDocumentChunks } from './documentIndex.js';
import { searchEmbeddedDocumentChunks, searchEmbeddedDocumentChunksAsync } from './documentEmbeddings.js';
import { rerankDocumentCandidates } from './documentRerank.js';
import { sqlConditionForItemKind } from './itemKind.js';
import { addTimeScopeConditions, normalizeTimeScope, resolveTimeScope } from './timeScope.js';
import { searchItemUnderstanding } from './itemUnderstanding.js';

const DEFAULT_MAX_SOURCES = Number(process.env.ASSISTANT_MAX_SOURCES || 8);
const DEFAULT_MAX_FALLBACK_SOURCES = Number(process.env.ASSISTANT_MAX_FALLBACK_SOURCES || 2);

function retrieveGroupSources({ db, groupId, question, task = 'ask', scope: rawScope = {}, maxSources = DEFAULT_MAX_SOURCES, maxFallbackSources = DEFAULT_MAX_FALLBACK_SOURCES, now = new Date() } = {}) {
  const scope = normalizeScope({
    ...rawScope,
    ...resolveTimeScope({ question, scope: rawScope, now }),
  });
  scope.personalOnly = false;
  const params = [groupId];
  const scopedConditions = scopeWhere(scope, params);
  const rows = db.prepare(`
    SELECT l.id, l.type, l.url, l.title, l.description, l.comment, l.content, l.content_md, l.summary, l.imported_at,
      gl.note AS group_note
    FROM links l
    JOIN group_links gl ON gl.link_id = l.id
    WHERE gl.group_id = ?
      AND (
        COALESCE(l.content_md, '') != ''
        OR COALESCE(l.summary, '') != ''
        OR COALESCE(l.content, '') != ''
        OR COALESCE(l.title, '') != ''
        OR COALESCE(l.comment, '') != ''
        OR COALESCE(gl.note, '') != ''
      )
      ${scopedConditions.length ? `AND ${scopedConditions.join(' AND ')}` : ''}
    ORDER BY l.imported_at DESC
    LIMIT 1000
  `).all(...params);
  const messageParams = [groupId];
  const messageTimeConditions = addTimeScopeConditions(scope, messageParams, 'm.created_at');
  const messageRows = db.prepare(`
    SELECT m.id, m.body, m.created_at, u.username
    FROM group_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ?
      AND m.message_type = 'text'
      AND COALESCE(m.body, '') != ''
      ${messageTimeConditions.length ? `AND ${messageTimeConditions.join(' AND ')}` : ''}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1000
  `).all(...messageParams).map(row => ({
    id: `group-message:${row.id}`,
    type: 'group_message',
    url: '',
    title: `${row.username || '成员'} 的群消息`,
    description: '',
    comment: '',
    content: row.body,
    content_md: row.body,
    summary: row.body,
    imported_at: row.created_at,
    source_kind: 'group_message',
  }));
  const candidates = [...rows, ...messageRows];

  if (task === 'recent') {
    return candidates
      .sort((a, b) => String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
      .slice(0, maxSources)
      .map((item, index) => ({ ...item, source_index: index + 1 }));
  }

  const tokens = tokenize(question);
  const ranked = candidates
    .map(item => ({ ...item, score: scoreItem(item, tokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, maxSources)
    .map((item, index) => ({ ...item, source_index: index + 1 }));

  if (ranked.length) return ranked;
  if (!shouldUseFallbackSources(task, question)) return [];
  return candidates
    .sort((a, b) => String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, maxFallbackSources)
    .map((item, index) => ({ ...item, source_index: index + 1 }));
}

function legacyChunkFallbackEnabled(includeLegacyFallback) {
  if (includeLegacyFallback !== undefined) return includeLegacyFallback !== false;
  return process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK !== '0';
}

function tokenize(text) {
  return tokenizeQuery(text);
}

function scoreItem(item, tokens) {
  let score = scoreTextFields(item, tokens, {
    title: 8,
    summary: 5,
    comment: 4,
    group_note: 4,
    url: 3,
    content_md: 1,
    content: 1,
  });

  if (item.summary) score += 1;
  if (item.content_md) score += 1;
  if (item.group_note) score += 1;
  return score;
}

function shouldUseFallbackSources(task, question) {
  if (task === 'ask') return false;
  if (task === 'recent') return true;
  return tokenize(question).length < 2;
}

function isLatestItemQuestion(question) {
  const text = String(question || '').replace(/\s+/g, '');
  if (!text) return false;
  const hasLatest = /最新|最近|刚刚|刚才|最后|上一条|新发|新传|新上传/.test(text);
  const hasItem = /发的|上传|传的|保存|资料|文件|图片|照片|视频|音频|文章|链接|内容|材料/.test(text);
  const asksIdentity = /是啥|是什么|哪个|哪一个|哪条|发了什么|传了什么|保存了什么|有啥|有什么/.test(text);
  return hasLatest && hasItem && asksIdentity;
}

function latestItemScopeFromQuestion(question) {
  const text = String(question || '').replace(/\s+/g, '');
  if (/文件|文档|pdf|PDF/.test(text)) return 'document';
  if (/图片|照片|图像/.test(text)) return 'image';
  if (/视频/.test(text)) return 'video';
  if (/音频|录音/.test(text)) return 'audio';
  if (/文章/.test(text)) return 'article';
  if (/链接/.test(text)) return 'link';
  return '';
}

function normalizeScope(scope = {}) {
  const type = String(scope.type || '').trim();
  return {
    ...normalizeTimeScope(scope),
    type,
  };
}

function scopeWhere(scope, params) {
  const conditions = addTimeScopeConditions(scope, params, 'l.imported_at');
  if (scope.personalOnly !== false && scope.hasScopeColumn !== false) conditions.unshift("COALESCE(l.scope, 'personal') = 'personal'");
  if (scope.type) {
    const condition = sqlConditionForItemKind(scope.type, 'l');
    conditions.push(condition.sql);
    params.push(...condition.params);
  }
  return conditions;
}

function latestItemRows({ db, userId, scope, maxSources }) {
  const params = [userId];
  const scopedConditions = scopeWhere(scope, params);
  const rows = db.prepare(`
    SELECT
      l.id, l.type, l.url, l.title, l.description, l.comment, l.content, l.content_md,
      l.summary, l.imported_at, l.created_at, l.status, l.image_path,
      'latest_item' AS source_kind,
      'latest_item' AS retrieval_mode,
      1000 AS score
    FROM links l
    WHERE l.user_id = ?
      ${scopedConditions.length ? `AND ${scopedConditions.join(' AND ')}` : ''}
    ORDER BY datetime(COALESCE(NULLIF(l.imported_at, ''), l.created_at)) DESC, l.id DESC
    LIMIT ?
  `).all(...params, maxSources);

  return rows.map((item, index) => ({
    ...item,
    source_index: index + 1,
    retrieval_modes: ['latest_item'],
    summary: item.summary || item.description || item.comment || item.content_md || item.content || latestItemSummary(item),
  }));
}

function latestItemSummary(item) {
  const parts = [
    item.title ? `标题：${item.title}` : '',
    item.type ? `类型：${item.type}` : '',
    item.url ? `链接：${item.url}` : '',
    item.imported_at ? `保存时间：${item.imported_at}` : (item.created_at ? `创建时间：${item.created_at}` : ''),
    item.status ? `处理状态：${item.status}` : '',
  ].filter(Boolean);
  return parts.join('\n');
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
  groupId,
  question,
  task = 'ask',
  scope: rawScope = {},
  maxSources = DEFAULT_MAX_SOURCES,
  maxFallbackSources = DEFAULT_MAX_FALLBACK_SOURCES,
  enableEmbeddings = process.env.ASSISTANT_ENABLE_EMBEDDINGS === '1',
  enableRerank = process.env.ASSISTANT_ENABLE_RERANK !== '0',
  includeLegacyFallback,
  now = new Date(),
} = {}) {
  if (groupId) {
    return retrieveGroupSources({ db, groupId, question, task, scope: rawScope, maxSources, maxFallbackSources, now });
  }
  const hasScopeColumn = db.prepare('PRAGMA table_info(links)').all().some(column => column.name === 'scope');
  indexAllMissingDocuments(db);
  const scope = normalizeScope({
    ...rawScope,
    ...resolveTimeScope({ question, scope: rawScope, now }),
  });
  const inferredLatestType = isLatestItemQuestion(question) && !scope.type
    ? latestItemScopeFromQuestion(question)
    : '';
  if (inferredLatestType) scope.type = inferredLatestType;
  scope.hasScopeColumn = hasScopeColumn;
  if (isLatestItemQuestion(question)) {
    return latestItemRows({ db, userId, scope, maxSources: 1 });
  }
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

  if (legacyChunkFallbackEnabled(includeLegacyFallback)) {
    indexAllMissingChunks(db);
    const chunks = searchRelevantChunks({ db, userId, query: question, task, limit: maxSources, scope });
    if (chunks.length) {
      return chunks.map((item, index) => ({ ...item, source_index: index + 1 }));
    }
  }

  const structuredRows = searchItemUnderstanding({ db, userId, query: question, limit: maxSources });
  if (structuredRows.length) {
    return structuredRows.map((item, index) => ({ ...item, source_index: index + 1 }));
  }

  if (!legacyChunkFallbackEnabled(includeLegacyFallback)) return [];

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

export async function retrieveSourcesAsync({
  db = defaultDb,
  userId,
  groupId,
  question,
  task = 'ask',
  scope: rawScope = {},
  maxSources = DEFAULT_MAX_SOURCES,
  maxFallbackSources = DEFAULT_MAX_FALLBACK_SOURCES,
  enableEmbeddings = process.env.ASSISTANT_ENABLE_EMBEDDINGS === '1',
  enableRerank = process.env.ASSISTANT_ENABLE_RERANK !== '0',
  includeLegacyFallback,
  now = new Date(),
  embeddingOptions = {},
} = {}) {
  if (groupId) {
    return retrieveGroupSources({ db, groupId, question, task, scope: rawScope, maxSources, maxFallbackSources, now });
  }
  const hasScopeColumn = db.prepare('PRAGMA table_info(links)').all().some(column => column.name === 'scope');
  const scope = normalizeScope({
    ...rawScope,
    ...resolveTimeScope({ question, scope: rawScope, now }),
  });
  const inferredLatestType = isLatestItemQuestion(question) && !scope.type
    ? latestItemScopeFromQuestion(question)
    : '';
  if (inferredLatestType) scope.type = inferredLatestType;
  scope.hasScopeColumn = hasScopeColumn;
  if (isLatestItemQuestion(question)) {
    return latestItemRows({ db, userId, scope, maxSources: 1 });
  }
  indexAllMissingDocuments(db);
  const documentChunks = searchDocumentChunks({ db, userId, query: question, task, limit: maxSources, scope });
  const embeddingChunks = enableEmbeddings
    ? await searchEmbeddedDocumentChunksAsync({
      db,
      userId,
      query: question,
      limit: maxSources,
      scope,
      ...embeddingOptions,
    })
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

  return retrieveSources({
    db,
    userId,
    question,
    task,
    scope,
    maxSources,
    maxFallbackSources,
    enableEmbeddings: false,
    enableRerank,
    includeLegacyFallback,
    now,
  });
}
