import { retrieveSources, retrieveSourcesAsync } from './assistantRetrieval.js';

function sourceKind(source) {
  if (source.sourceKind || source.source_kind) return source.sourceKind || source.source_kind;
  return source.document_id ? 'document' : 'legacy';
}

function normalizeSource(source, index) {
  const linkId = source.link_id || source.item_id || source.id;
  return {
    ...source,
    id: linkId,
    link_id: linkId,
    sourceKind: sourceKind(source),
    heading_path: source.heading_path || '',
    score: Number(source.score ?? source.combined_score ?? 0),
    source_index: source.source_index || index + 1,
  };
}

function normalizeSnippet(source) {
  return String(source.chunk_text || source.summary || source.content_md || source.content || source.description || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function normalizeRetrievalModes(source) {
  if (Array.isArray(source.retrieval_modes)) return source.retrieval_modes;
  return source.retrieval_mode ? [source.retrieval_mode] : [];
}

function resolveIncludeLegacyFallback(includeLegacyFallback) {
  if (includeLegacyFallback !== undefined) return includeLegacyFallback !== false;
  return process.env.ASSISTANT_ENABLE_LEGACY_FALLBACK !== '0';
}

export function buildRetrievalDiagnostics({
  question,
  task = 'ask',
  scope = {},
  sources = [],
  settings = {},
} = {}) {
  return {
    query: String(question || ''),
    task,
    scope: scope || {},
    settings: settings || {},
    sources: sources.map((source, index) => {
      const linkId = source.link_id || source.item_id || source.id;
      return {
        id: linkId,
        link_id: linkId,
        sourceKind: source.sourceKind || sourceKind(source),
        source_index: source.source_index || index + 1,
        title: source.title || source.url || `资料 ${linkId}`,
        url: source.url || '',
        score: Number(source.score ?? source.combined_score ?? 0),
        combined_score: source.combined_score === undefined ? undefined : Number(source.combined_score),
        embedding_score: source.embedding_score === undefined ? undefined : Number(source.embedding_score),
        retrieval_modes: normalizeRetrievalModes(source),
        rerank_mode: source.rerank_mode,
        rerank_score: source.rerank_score === undefined ? undefined : Number(source.rerank_score),
        document_id: source.document_id,
        chunk_id: source.chunk_id,
        heading_path: source.heading_path || '',
        chunk_type: source.chunk_type,
        snippet: normalizeSnippet(source),
      };
    }),
  };
}

export function retrieveAssistantSources(db, {
  userId,
  groupId,
  question,
  task = 'ask',
  scope = {},
  limit,
  maxSources = limit,
  maxFallbackSources,
  includeLegacyFallback,
  enableEmbeddings,
  enableRerank,
  now,
} = {}) {
  const shouldIncludeLegacyFallback = resolveIncludeLegacyFallback(includeLegacyFallback);
  const sources = retrieveSources({
    db,
    userId,
    groupId,
    question,
    task,
    scope,
    maxSources,
    maxFallbackSources,
    includeLegacyFallback: shouldIncludeLegacyFallback,
    enableEmbeddings,
    enableRerank,
    now,
  });

  return sources
    .filter(source => shouldIncludeLegacyFallback || source.document_id)
    .map(normalizeSource);
}

export async function retrieveAssistantSourcesAsync(db, {
  userId,
  groupId,
  question,
  task = 'ask',
  scope = {},
  limit,
  maxSources = limit,
  maxFallbackSources,
  includeLegacyFallback,
  enableEmbeddings,
  enableRerank,
  now,
  embeddingOptions,
} = {}) {
  const shouldIncludeLegacyFallback = resolveIncludeLegacyFallback(includeLegacyFallback);
  const sources = await retrieveSourcesAsync({
    db,
    userId,
    groupId,
    question,
    task,
    scope,
    maxSources,
    maxFallbackSources,
    includeLegacyFallback: shouldIncludeLegacyFallback,
    enableEmbeddings,
    enableRerank,
    now,
    embeddingOptions,
  });

  return sources
    .filter(source => shouldIncludeLegacyFallback || source.document_id)
    .map(normalizeSource);
}
