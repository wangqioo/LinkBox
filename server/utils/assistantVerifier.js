function uniqueNumbers(values) {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function citationNumbers(answer) {
  const matches = String(answer || '').matchAll(/\[资料(\d+)\]/g);
  return uniqueNumbers(Array.from(matches, match => Number(match[1])).filter(Number.isFinite));
}

export function verifyEvidence(evidence = {}, { retrievalConfidence = null } = {}) {
  const items = Array.isArray(evidence.items) ? evidence.items : [];
  const issues = [];
  if (!items.length) issues.push('no_evidence');
  const hasSnippet = items.some(item => String(item.snippet || '').trim());
  if (items.length && !hasSnippet) issues.push('weak_evidence');
  if (items.length && retrievalConfidence?.level === 'low') issues.push('low_retrieval_confidence');
  if (items.length && retrievalConfidence?.level === 'insufficient') issues.push('insufficient_retrieval_confidence');

  const support = !items.length
    ? 'insufficient'
    : (hasSnippet && retrievalConfidence?.level !== 'low' && retrievalConfidence?.level !== 'insufficient' ? 'supported' : 'partial');
  return {
    phase: 'retrieval',
    support,
    evidenceCount: items.length,
    issues,
    ...(retrievalConfidence ? { retrievalConfidence } : {}),
  };
}

export function verifyAssistantAnswer({
  answer = '',
  evidence = {},
  sourceCount,
} = {}) {
  const base = verifyEvidence(evidence);
  if (base.support === 'insufficient') {
    return {
      ...base,
      phase: 'answer',
      citations: { used: [], invalid: [] },
    };
  }

  const maxSource = Number(sourceCount || evidence.items?.length || 0);
  const used = citationNumbers(answer);
  const invalid = used.filter(value => value < 1 || value > maxSource);
  const issues = [...base.issues];
  if (!used.length) issues.push('missing_citation');
  if (invalid.length) issues.push('citation_out_of_range');

  return {
    phase: 'answer',
    support: invalid.length || !used.length || base.support === 'partial' ? 'partial' : 'supported',
    evidenceCount: base.evidenceCount,
    issues,
    citations: {
      used,
      invalid,
    },
  };
}
