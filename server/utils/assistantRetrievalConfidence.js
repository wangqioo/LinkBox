import { tokenizeQuery } from './chunkIndex.js';

function sourceText(source) {
  return [
    source?.title,
    source?.heading_path,
    source?.chunk_text,
    source?.summary,
    source?.content_md,
    source?.content,
    source?.description,
  ].map(value => String(value || '').toLowerCase()).join('\n');
}

function retrievalModes(source) {
  if (Array.isArray(source?.retrieval_modes)) return source.retrieval_modes;
  if (Array.isArray(source?.retrievalModes)) return source.retrievalModes;
  return source?.retrieval_mode ? [source.retrieval_mode] : [];
}

function hasSnippet(source) {
  return Boolean(String(source?.chunk_text || source?.summary || source?.content_md || source?.content || source?.description || '').trim());
}

function queryCoverage(question, sources) {
  const tokens = tokenizeQuery(question).filter(token => String(token).length >= 2);
  if (!tokens.length) return 0;
  const haystack = sources.map(sourceText).join('\n');
  const matched = tokens.filter(token => haystack.includes(String(token).toLowerCase())).length;
  return matched / tokens.length;
}

function averageScore(sources) {
  const scores = sources
    .map(source => Number(source?.score ?? source?.combined_score ?? source?.rerank_score ?? 0))
    .filter(Number.isFinite);
  if (!scores.length) return 0;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function sourceKinds(sources) {
  return new Set(sources.map(source => source?.sourceKind || source?.source_kind || (source?.document_id ? 'document' : 'legacy')).filter(Boolean));
}

function modeDiversity(sources) {
  return new Set(sources.flatMap(retrievalModes).filter(Boolean)).size;
}

function confidenceLevel(score) {
  if (score >= 70) return 'high';
  if (score >= 42) return 'medium';
  if (score > 0) return 'low';
  return 'insufficient';
}

export function assessRetrievalConfidence({
  question = '',
  sources = [],
  attempts = [],
} = {}) {
  const rows = Array.isArray(sources) ? sources : [];
  const reasons = [];
  if (!rows.length) {
    return {
      level: 'insufficient',
      score: 0,
      shouldCorrect: true,
      reasons: ['no_sources'],
      signals: {
        sourceCount: 0,
        snippetRatio: 0,
        queryCoverage: 0,
        modeDiversity: 0,
        sourceKindDiversity: 0,
        averageScore: 0,
        attemptCount: Array.isArray(attempts) ? attempts.length : 0,
      },
    };
  }

  const snippetRatio = rows.filter(hasSnippet).length / rows.length;
  const coverage = queryCoverage(question, rows);
  const modes = modeDiversity(rows);
  const kinds = sourceKinds(rows).size;
  const avgScore = averageScore(rows);

  if (rows.length === 1) reasons.push('single_source');
  if (snippetRatio < 0.75) reasons.push('weak_snippets');
  if (coverage < 0.5) reasons.push('low_query_coverage');
  if (modes <= 1) reasons.push('single_retrieval_mode');

  let score = 0;
  score += Math.min(rows.length, 3) * 16;
  score += snippetRatio * 20;
  score += coverage * 28;
  score += Math.min(modes, 3) * 7;
  score += Math.min(kinds, 2) * 5;
  score += Math.min(Math.max(avgScore, 0), 1) * 10;
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (rows.length === 1 && coverage < 0.5) score = Math.min(score, 41);
  if (rows.length === 1 && modes <= 1 && avgScore > 0 && avgScore < 0.2) score = Math.min(score, 41);
  if (snippetRatio < 0.5) score = Math.min(score, 41);

  const level = confidenceLevel(score);
  return {
    level,
    score,
    shouldCorrect: level === 'insufficient' || level === 'low',
    reasons,
    signals: {
      sourceCount: rows.length,
      snippetRatio,
      queryCoverage: coverage,
      modeDiversity: modes,
      sourceKindDiversity: kinds,
      averageScore: avgScore,
      attemptCount: Array.isArray(attempts) ? attempts.length : 0,
    },
  };
}
