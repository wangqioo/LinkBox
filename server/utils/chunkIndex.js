import db from '../db.js';

const TARGET_CHARS = 1200;
const OVERLAP_CHARS = 180;
const MAX_CHUNKS_PER_LINK = 80;
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

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function splitIntoChunks(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length <= TARGET_CHARS) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }

    if (current) chunks.push(current);

    if (paragraph.length <= TARGET_CHARS) {
      current = paragraph;
      continue;
    }

    for (let i = 0; i < paragraph.length; i += TARGET_CHARS - OVERLAP_CHARS) {
      chunks.push(paragraph.slice(i, i + TARGET_CHARS));
      if (chunks.length >= MAX_CHUNKS_PER_LINK) return chunks;
    }
    current = '';
  }

  if (current) chunks.push(current);
  return chunks.slice(0, MAX_CHUNKS_PER_LINK);
}

export function indexLinkContent(linkId) {
  const link = db.prepare('SELECT id, user_id, title, summary, content, content_md FROM links WHERE id = ?').get(linkId);
  if (!link) return 0;

  const body = [
    link.title ? `# ${link.title}` : '',
    link.summary ? `摘要：${link.summary}` : '',
    link.content_md || link.content || '',
  ].filter(Boolean).join('\n\n');

  const chunks = splitIntoChunks(body);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM link_chunks WHERE link_id = ?').run(link.id);
    const insert = db.prepare(`
      INSERT INTO link_chunks (link_id, user_id, chunk_index, text)
      VALUES (?, ?, ?, ?)
    `);
    chunks.forEach((chunk, index) => insert.run(link.id, link.user_id, index, chunk));
  });
  tx();
  return chunks.length;
}

export function removeLinkContentIndex(linkId) {
  db.prepare('DELETE FROM link_chunks WHERE link_id = ?').run(linkId);
}

export function indexAllMissingChunks() {
  const rows = db.prepare(`
    SELECT l.id
    FROM links l
    LEFT JOIN link_chunks c ON c.link_id = l.id
    WHERE c.id IS NULL
      AND (COALESCE(l.content_md, '') != '' OR COALESCE(l.content, '') != '' OR COALESCE(l.summary, '') != '')
    ORDER BY l.imported_at DESC
    LIMIT 200
  `).all();
  let total = 0;
  for (const row of rows) total += indexLinkContent(row.id);
  return { links: rows.length, chunks: total };
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

function scoreChunk(row, tokens) {
  const title = String(row.title || '').toLowerCase();
  const summary = String(row.summary || '').toLowerCase();
  const chunk = String(row.chunk_text || '').toLowerCase();
  let score = 0;

  for (const token of tokens) {
    const weight = tokenWeight(token);
    if (title.includes(token)) score += 16 * weight;
    if (summary.includes(token)) score += 10 * weight;
    if (chunk.includes(token)) score += 2 * weight;
  }

  return score;
}

export function scoreChunkForQuery(row, query) {
  return scoreChunk(row, tokenizeQuery(query));
}

export function rankChunkRows(rows, { query, limit = 12 }) {
  const tokens = tokenizeQuery(query);
  return rows
    .map(row => ({ ...row, score: scoreChunk(row, tokens) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, limit);
}

function trimWeakMatches(ranked) {
  if (!ranked.length) return ranked;
  const top = ranked[0].score || 0;
  const minScore = Math.max(6, Math.ceil(top * 0.35));
  return ranked.filter(row => row.score >= minScore);
}

function normalizeUrlKey(url) {
  return String(url || '')
    .trim()
    .replace(/#.*$/, '')
    .replace(/[?&]utm_[^=&]+=[^&]*/gi, '')
    .replace(/[?&](from|scene|clicktime|enterid|ascene|devicetype|version|nettype|lang)=[^&]*/gi, '')
    .replace(/[?&]$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function normalizeTitleKey(title) {
  return String(title || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sourceKey(row) {
  const url = normalizeUrlKey(row.url);
  const title = normalizeTitleKey(row.title);
  if (title && (url.includes('mp.weixin.qq.com') || title.length >= 8)) return `title:${title}`;
  if (url) return `url:${url}`;
  if (title) return `title:${title}`;
  return `id:${row.id}`;
}

function limitBySource(ranked, maxSources) {
  const sourceCount = new Set();
  const kept = [];
  for (const row of ranked) {
    sourceCount.add(sourceKey(row));
    if (sourceCount.size > maxSources) break;
    kept.push(row);
  }
  return kept;
}

function normalizeScope(scope = {}) {
  const date = String(scope.date || '').trim();
  const type = String(scope.type || '').trim();
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    type: type === 'document' ? 'file' : type,
  };
}

function scopeWhere(scope, params) {
  const conditions = [];
  if (scope.date) {
    conditions.push('substr(l.imported_at, 1, 10) = ?');
    params.push(scope.date);
  }
  if (scope.type) {
    conditions.push('l.type = ?');
    params.push(scope.type);
  }
  return conditions;
}

export function searchRelevantChunks({ userId, query, task = 'ask', limit = 12, scope: rawScope = {} }) {
  const scope = normalizeScope(rawScope);

  if (task === 'recent') {
    const params = [userId];
    const scopedConditions = scopeWhere(scope, params);
    params.push(Math.max(limit * 30, 200));
    const rows = db.prepare(`
      SELECT c.id AS chunk_id, c.chunk_index, c.text AS chunk_text,
             l.id, l.type, l.url, l.title, l.summary, l.imported_at
      FROM link_chunks c
      JOIN links l ON l.id = c.link_id
      WHERE c.user_id = ?
        ${scopedConditions.length ? `AND ${scopedConditions.join(' AND ')}` : ''}
      ORDER BY l.imported_at DESC, c.chunk_index ASC
      LIMIT ?
    `).all(...params);
    return limitBySource(rows, limit);
  }

  const params = [userId];
  const scopedConditions = scopeWhere(scope, params);
  const rows = db.prepare(`
    SELECT c.id AS chunk_id, c.chunk_index, c.text AS chunk_text,
           l.id, l.type, l.url, l.title, l.summary, l.imported_at
    FROM link_chunks c
    JOIN links l ON l.id = c.link_id
    WHERE c.user_id = ?
      ${scopedConditions.length ? `AND ${scopedConditions.join(' AND ')}` : ''}
    ORDER BY l.imported_at DESC
    LIMIT 2000
  `).all(...params);

  const ranked = rankChunkRows(rows, { query, limit: 2000 });
  if (!ranked.length && task !== 'ask') return limitBySource(rows, limit);
  return limitBySource(trimWeakMatches(ranked), Math.min(4, limit));
}
