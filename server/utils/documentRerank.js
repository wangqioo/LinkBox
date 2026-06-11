import { tokenizeQuery } from './chunkIndex.js';

function normalizedText(value) {
  return String(value || '').toLowerCase();
}

function includesPhrase(text, query) {
  const phrase = normalizedText(query).trim();
  return phrase.length >= 3 && normalizedText(text).includes(phrase);
}

function tokenCoverage(text, tokens) {
  if (!tokens.length) return 0;
  const haystack = normalizedText(text);
  const matched = tokens.filter(token => haystack.includes(normalizedText(token))).length;
  return matched / tokens.length;
}

function sourceDiversityBoost(item) {
  const modes = Array.isArray(item.retrieval_modes)
    ? item.retrieval_modes
    : (item.retrieval_mode ? [item.retrieval_mode] : []);
  return new Set(modes).size > 1 ? 12 : 0;
}

function recencyTieBreak(item) {
  const time = Date.parse(item.imported_at || '');
  return Number.isFinite(time) ? time / 100000000000000 : 0;
}

export function scoreRerankCandidate(item, { query, tokens }) {
  const title = normalizedText(item.title);
  const heading = normalizedText(item.heading_path);
  const content = normalizedText(item.chunk_text || item.content || '');
  const titleHeading = `${title}\n${heading}`;
  const allText = `${titleHeading}\n${content}`;

  let score = Number(item.combined_score || item.score || 0) * 0.2;
  score += tokenCoverage(titleHeading, tokens) * 80;
  score += tokenCoverage(content, tokens) * 45;
  if (includesPhrase(titleHeading, query)) score += 60;
  if (includesPhrase(content, query)) score += 35;
  score += sourceDiversityBoost(item);
  score += recencyTieBreak(item);
  if (!allText.trim()) score -= 100;
  return score;
}

export function rerankDocumentCandidates(candidates, { query, limit = candidates.length } = {}) {
  const tokens = tokenizeQuery(query);
  return [...candidates]
    .map(item => ({
      ...item,
      rerank_mode: 'local',
      rerank_score: scoreRerankCandidate(item, { query, tokens }),
    }))
    .sort((a, b) => b.rerank_score - a.rerank_score || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, limit);
}
