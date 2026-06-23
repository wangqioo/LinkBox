import db from '../db.js';
import { sqlConditionForItemKind } from './itemKind.js';
import { addTimeScopeConditions, normalizeTimeScope } from './timeScope.js';
import { scoreTextFields, tokenizeQuery } from './textScoring.js';

export { scoreTextFields, tokenizeQuery } from './textScoring.js';

const TARGET_CHARS = 1200;
const OVERLAP_CHARS = 180;
const MAX_CHUNKS_PER_LINK = 80;

function hasLinksScopeColumn(database) {
  return database.prepare('PRAGMA table_info(links)').all().some(column => column.name === 'scope');
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

export function indexLinkContent(linkId, database = db) {
  const link = database.prepare('SELECT id, user_id, title, summary, comment, content, content_md FROM links WHERE id = ?').get(linkId);
  if (!link) return 0;

  const body = [
    link.title ? `# ${link.title}` : '',
    link.summary ? `摘要：${link.summary}` : '',
    link.comment ? `我的留言：${link.comment}` : '',
    link.content_md || link.content || '',
  ].filter(Boolean).join('\n\n');

  const chunks = splitIntoChunks(body);
  const tx = database.transaction(() => {
    database.prepare('DELETE FROM link_chunks WHERE link_id = ?').run(link.id);
    const insert = database.prepare(`
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

export function indexAllMissingChunks(database = db) {
  const scopeCondition = hasLinksScopeColumn(database) ? "AND COALESCE(l.scope, 'personal') = 'personal'" : '';
  const rows = database.prepare(`
    SELECT l.id
    FROM links l
    LEFT JOIN link_chunks c ON c.link_id = l.id
    WHERE c.id IS NULL
      ${scopeCondition}
      AND (COALESCE(l.content_md, '') != '' OR COALESCE(l.content, '') != '' OR COALESCE(l.summary, '') != '')
    ORDER BY l.imported_at DESC
    LIMIT 200
  `).all();
  let total = 0;
  for (const row of rows) total += indexLinkContent(row.id, database);
  return { links: rows.length, chunks: total };
}

function scoreChunk(row, tokens) {
  const title = String(row.title || '').toLowerCase();
  const summary = String(row.summary || '').toLowerCase();
  const chunk = String(row.chunk_text || '').toLowerCase();
  return scoreTextFields({ title, summary, chunk }, tokens, {
    title: 16,
    summary: 10,
    chunk: 2,
  });
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
  const type = String(scope.type || '').trim();
  return {
    ...normalizeTimeScope(scope),
    type,
  };
}

function scopeWhere(scope, params) {
  const conditions = addTimeScopeConditions(scope, params, 'l.imported_at');
  if (scope.hasScopeColumn !== false) conditions.unshift("COALESCE(l.scope, 'personal') = 'personal'");
  if (scope.type) {
    const condition = sqlConditionForItemKind(scope.type, 'l');
    conditions.push(condition.sql);
    params.push(...condition.params);
  }
  return conditions;
}

export function searchRelevantChunks({ db: database = db, userId, query, task = 'ask', limit = 12, scope: rawScope = {} }) {
  const scope = { ...normalizeScope(rawScope), hasScopeColumn: hasLinksScopeColumn(database) };

  if (task === 'recent') {
    const params = [userId];
    const scopedConditions = scopeWhere(scope, params);
    params.push(Math.max(limit * 30, 200));
    const rows = database.prepare(`
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
  const rows = database.prepare(`
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
