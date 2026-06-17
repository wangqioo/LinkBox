const STOP_CJK = new Set([
  '的', '了', '和', '是', '在', '有', '为', '与', '及', '或', '也', '都', '能', '会',
  '什么', '为什么', '怎么', '如何', '这个', '那个', '这些', '那些', '主要', '原因',
]);

export function tokenizeQuery(text) {
  const normalized = String(text || '').toLowerCase();
  const latin = normalized.match(/[a-z0-9_\-]{2,}/g) || [];
  const cjkPhrases = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const cjk = [];

  for (const phrase of cjkPhrases) {
    if (phrase.length <= 6) cjk.push(phrase);
    for (let i = 0; i < phrase.length - 1; i += 1) cjk.push(phrase.slice(i, i + 2));
    for (let i = 0; i < phrase.length - 2; i += 1) cjk.push(phrase.slice(i, i + 3));
  }

  return [...new Set([...latin, ...cjk])]
    .filter(token => token.length >= 2 && !STOP_CJK.has(token))
    .slice(0, 120);
}

function tokenWeight(token) {
  if (/^[\u4e00-\u9fa5]{4,}$/.test(token)) return 4;
  if (/^[\u4e00-\u9fa5]{3}$/.test(token)) return 2;
  if (/^[a-z0-9_\-]{4,}$/.test(token)) return 2;
  return 1;
}

export function scoreTextFields(fields, queryOrTokens, weights = {}) {
  const tokens = Array.isArray(queryOrTokens) ? queryOrTokens : tokenizeQuery(queryOrTokens);
  let score = 0;
  for (const token of tokens) {
    const tokenScore = tokenWeight(token);
    for (const [field, fieldWeight] of Object.entries(weights)) {
      if (String(fields[field] || '').toLowerCase().includes(token)) {
        score += fieldWeight * tokenScore;
      }
    }
  }
  return score;
}
