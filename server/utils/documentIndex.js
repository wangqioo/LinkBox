import { createHash } from 'crypto';
import { scoreTextFields, tokenizeQuery } from './textScoring.js';
import { addTimeScopeConditions } from './timeScope.js';

export const DOCUMENT_PARSER_VERSION = 'linkbox-canonical-v1';
const TARGET_CHARS = 1400;
const MAX_CHUNKS_PER_DOCUMENT = 120;

function isoNow() {
  return new Date().toISOString();
}

function hashText(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function yamlScalar(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '\\"')
    .trim();
}

function estimateTokens(text) {
  const raw = String(text || '').trim();
  if (!raw) return 0;
  const latin = raw.match(/[a-z0-9_\-]+/gi)?.length || 0;
  const cjk = raw.match(/[\u4e00-\u9fa5]/g)?.length || 0;
  return latin + Math.ceil(cjk / 1.7);
}

export function initDocumentSchema(db) {
  if (!db) throw new Error('initDocumentSchema requires a database');
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT DEFAULT '',
      markdown TEXT NOT NULL,
      markdown_hash TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      language TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE,
      UNIQUE(item_id, parser_version)
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      heading_path TEXT DEFAULT '',
      chunk_type TEXT DEFAULT 'text',
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      char_start INTEGER NOT NULL DEFAULT 0,
      char_end INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT DEFAULT '{}',
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      UNIQUE(document_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS idx_documents_item ON documents(item_id);
    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON document_chunks(document_id);

    CREATE TABLE IF NOT EXISTS document_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      vector TEXT NOT NULL,
      content_hash TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chunk_id) REFERENCES document_chunks(id) ON DELETE CASCADE,
      UNIQUE(chunk_id, provider, model)
    );

    CREATE INDEX IF NOT EXISTS idx_document_embeddings_chunk ON document_embeddings(chunk_id);
    CREATE INDEX IF NOT EXISTS idx_document_embeddings_model ON document_embeddings(provider, model);

    CREATE TABLE IF NOT EXISTS document_annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      content_json TEXT NOT NULL,
      model TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_document_annotations_document ON document_annotations(document_id);
  `);
}

function bodyMarkdownForItem(item) {
  if (item.content_md?.trim()) return item.content_md.trim();
  if (item.content?.trim()) return item.content.trim();
  if (item.summary?.trim()) return item.summary.trim();
  if (item.description?.trim()) return item.description.trim();
  return '';
}

export function buildCanonicalMarkdown(item) {
  const title = item.title || item.url || `Item ${item.id}`;
  const body = bodyMarkdownForItem(item);
  const frontmatter = [
    '---',
    `title: ${yamlScalar(title)}`,
    `source_type: ${yamlScalar(item.type || 'link')}`,
    item.url ? `source_url: ${yamlScalar(item.url)}` : '',
    `item_id: ${item.id}`,
    item.imported_at ? `imported_at: ${yamlScalar(item.imported_at)}` : '',
    `parser: ${DOCUMENT_PARSER_VERSION}`,
    '---',
  ].filter(Boolean).join('\n');

  const titleHeading = `# ${title}`;
  const normalizedBody = body.replace(/^\s*#\s+.+\n*/, '').trim();
  return `${frontmatter}\n\n${titleHeading}${normalizedBody ? `\n\n${normalizedBody}` : ''}\n`;
}

function isHeading(line) {
  return /^(#{1,6})\s+(.+?)\s*$/.test(line);
}

function headingInfo(line) {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!match) return null;
  return {
    level: match[1].length,
    title: match[2].replace(/#+\s*$/, '').trim(),
  };
}

function classifyChunk(content) {
  const trimmed = content.trim();
  if (/^```/.test(trimmed)) return 'code';
  if (/^\|.+\|\n\|[\s:-]+\|/m.test(trimmed)) return 'table';
  if (/!\[[^\]]*\]\([^)]+\)/.test(trimmed)) return 'image';
  if (/^[-*+]\s+/m.test(trimmed) || /^\d+\.\s+/m.test(trimmed)) return 'list';
  return 'text';
}

function flushChunk(chunks, state, content, start, end) {
  const clean = content.trim();
  if (!clean) return;
  const headingPath = state.headings.map(heading => heading.title).join(' > ');
  chunks.push({
    headingPath,
    chunkType: classifyChunk(clean),
    content: clean,
    charStart: start,
    charEnd: end,
  });
}

export function splitMarkdownIntoSemanticChunks(markdown) {
  const body = String(markdown || '').replace(/^---\n[\s\S]*?\n---\n*/, '');
  const lines = body.split(/\r?\n/);
  const chunks = [];
  const state = { headings: [] };
  let buffer = [];
  let start = 0;
  let cursor = 0;
  let inCode = false;
  let inTable = false;

  for (const line of lines) {
    const lineWithNewline = `${line}\n`;
    const info = !inCode ? headingInfo(line) : null;
    const startsCode = line.startsWith('```');
    const startsTable = !inCode && /^\|.+\|\s*$/.test(line);
    const continuesTable = inTable && startsTable;

    if (startsCode && !inCode) {
      flushChunk(chunks, state, buffer.join('\n'), start, cursor);
      buffer = [line];
      start = cursor;
      inCode = true;
      cursor += lineWithNewline.length;
      continue;
    }

    if (info) {
      flushChunk(chunks, state, buffer.join('\n'), start, cursor);
      buffer = [];
      state.headings = state.headings.filter(heading => heading.level < info.level);
      state.headings.push(info);
      start = cursor + lineWithNewline.length;
      cursor += lineWithNewline.length;
      continue;
    }

    if (startsTable && !continuesTable) {
      flushChunk(chunks, state, buffer.join('\n'), start, cursor);
      buffer = [line];
      start = cursor;
      inTable = true;
      cursor += lineWithNewline.length;
      continue;
    }

    if (inTable && !startsTable) {
      flushChunk(chunks, state, buffer.join('\n'), start, cursor);
      buffer = [];
      inTable = false;
      start = cursor;
      if (!line.trim()) {
        cursor += lineWithNewline.length;
        start = cursor;
        continue;
      }
    }

    if (startsCode && inCode) {
      buffer.push(line);
      cursor += lineWithNewline.length;
      flushChunk(chunks, state, buffer.join('\n'), start, cursor);
      buffer = [];
      inCode = false;
      start = cursor;
      continue;
    }

    const next = buffer.length ? `${buffer.join('\n')}\n${line}` : line;
    if (next.length > TARGET_CHARS && buffer.length) {
      flushChunk(chunks, state, buffer.join('\n'), start, cursor);
      buffer = [line];
      start = cursor;
    } else {
      buffer.push(line);
    }
    cursor += lineWithNewline.length;
  }

  flushChunk(chunks, state, buffer.join('\n'), start, cursor);
  return chunks.slice(0, MAX_CHUNKS_PER_DOCUMENT);
}

export function indexDocumentForItem(db, itemId) {
  if (!db) throw new Error('indexDocumentForItem requires a database');
  initDocumentSchema(db);
  const item = db.prepare('SELECT * FROM links WHERE id = ?').get(itemId);
  if (!item) return { documentId: null, chunkCount: 0 };

  const markdown = buildCanonicalMarkdown(item);
  const markdownHash = hashText(markdown);
  const now = isoNow();
  db.prepare(`
    INSERT INTO documents (item_id, user_id, title, markdown, markdown_hash, parser_version, language, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)
    ON CONFLICT(item_id, parser_version) DO UPDATE SET
      user_id = excluded.user_id,
      title = excluded.title,
      markdown = excluded.markdown,
      markdown_hash = excluded.markdown_hash,
      language = excluded.language,
      status = 'ready',
      updated_at = excluded.updated_at
  `).run(item.id, item.user_id, item.title || item.url || `Item ${item.id}`, markdown, markdownHash, DOCUMENT_PARSER_VERSION, '', now);

  const document = db.prepare('SELECT id FROM documents WHERE item_id = ? AND parser_version = ?')
    .get(item.id, DOCUMENT_PARSER_VERSION);
  const chunks = splitMarkdownIntoSemanticChunks(markdown);

  replaceDocumentChunks(db, document.id, chunks);

  return { documentId: document.id, chunkCount: chunks.length };
}

export function replaceDocumentChunks(db, documentId, chunks) {
  const tx = db.transaction(() => {
    db.prepare(`
      DELETE FROM document_embeddings
      WHERE chunk_id IN (
        SELECT id FROM document_chunks WHERE document_id = ?
      )
    `).run(documentId);
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(documentId);
    const insert = db.prepare(`
      INSERT INTO document_chunks (
        document_id, chunk_index, heading_path, chunk_type, content,
        content_hash, token_count, char_start, char_end, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    chunks.forEach((chunk, index) => {
      insert.run(
        documentId,
        index,
        chunk.headingPath,
        chunk.chunkType,
        chunk.content,
        hashText(chunk.content),
        estimateTokens(chunk.content),
        chunk.charStart,
        chunk.charEnd,
        '{}',
      );
    });
  });
  tx();
  return chunks.length;
}

export function rechunkDocument(db, documentId) {
  if (!db) throw new Error('rechunkDocument requires a database');
  initDocumentSchema(db);
  const document = db.prepare('SELECT id, markdown FROM documents WHERE id = ?').get(documentId);
  if (!document) return { documentId: null, chunkCount: 0 };
  const chunks = splitMarkdownIntoSemanticChunks(document.markdown);
  return { documentId: document.id, chunkCount: replaceDocumentChunks(db, document.id, chunks) };
}

export function indexAllMissingDocuments(db, { limit = 200 } = {}) {
  if (!db) throw new Error('indexAllMissingDocuments requires a database');
  initDocumentSchema(db);
  const rows = db.prepare(`
    SELECT l.id
    FROM links l
    LEFT JOIN documents d ON d.item_id = l.id AND d.parser_version = ?
    WHERE d.id IS NULL
      AND (
        COALESCE(l.content_md, '') != ''
        OR COALESCE(l.content, '') != ''
        OR COALESCE(l.summary, '') != ''
        OR COALESCE(l.description, '') != ''
      )
    ORDER BY l.imported_at DESC
    LIMIT ?
  `).all(DOCUMENT_PARSER_VERSION, limit);

  let chunks = 0;
  for (const row of rows) chunks += indexDocumentForItem(db, row.id).chunkCount;
  return { documents: rows.length, chunks };
}

function scoreDocumentChunk(row, tokens) {
  return scoreTextFields(row, tokens, {
    title: 16,
    summary: 10,
    comment: 8,
    heading_path: 8,
    content: 2,
    url: 3,
  });
}

export function searchDocumentChunks({ db, userId, query, limit = 12, scope = {} }) {
  if (!db) throw new Error('searchDocumentChunks requires a database');
  initDocumentSchema(db);
  const tokens = tokenizeQuery(query);
  const params = [userId];
  const conditions = ['d.user_id = ?'];

  conditions.push(...addTimeScopeConditions(scope, params, 'l.imported_at'));
  if (scope.type) {
    conditions.push('l.type = ?');
    params.push(scope.type === 'document' ? 'file' : scope.type);
  }

  const rows = db.prepare(`
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
      l.imported_at
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    JOIN links l ON l.id = d.item_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY l.imported_at DESC, c.chunk_index ASC
    LIMIT 2000
  `).all(...params);

  return rows
    .map(row => ({ ...row, score: scoreDocumentChunk(row, tokens) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, limit);
}
