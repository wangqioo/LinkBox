import { retrieveSources } from './assistantRetrieval.js';

function sourceKind(source) {
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

export function retrieveAssistantSources(db, {
  userId,
  question,
  task = 'ask',
  scope = {},
  limit,
  maxSources = limit,
  maxFallbackSources,
  includeLegacyFallback = true,
  enableEmbeddings,
  enableRerank,
  now,
} = {}) {
  const sources = retrieveSources({
    db,
    userId,
    question,
    task,
    scope,
    maxSources,
    maxFallbackSources,
    enableEmbeddings,
    enableRerank,
    now,
  });

  return sources
    .filter(source => includeLegacyFallback || source.document_id)
    .map(normalizeSource);
}
