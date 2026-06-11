import { indexDocumentForItem, rechunkDocument } from './documentIndex.js';

export class DocumentInspectorError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DocumentInspectorError';
    this.status = status;
  }
}

function getOwnedItem(db, { itemId, userId }) {
  return db.prepare(`
    SELECT id, user_id, type, url, title, summary, status, imported_at
    FROM links
    WHERE id = ? AND user_id = ?
  `).get(itemId, userId);
}

function getDocumentRow(db, itemId) {
  return db.prepare(`
    SELECT id, item_id, user_id, title, markdown, markdown_hash, parser_version,
           language, status, created_at, updated_at
    FROM documents
    WHERE item_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(itemId);
}

function getChunkRows(db, documentId) {
  return db.prepare(`
    SELECT id, document_id, chunk_index, heading_path, chunk_type, content,
           content_hash, token_count, char_start, char_end, metadata_json
    FROM document_chunks
    WHERE document_id = ?
    ORDER BY chunk_index ASC
  `).all(documentId);
}

function getAnnotationRows(db, documentId) {
  return db.prepare(`
    SELECT id, document_id, type, content_json, model, created_at
    FROM document_annotations
    WHERE document_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(documentId);
}

function getEmbeddingStats(db, documentId) {
  const rows = db.prepare(`
    SELECT e.provider, e.model, e.dimension, COUNT(*) AS count
    FROM document_embeddings e
    JOIN document_chunks c ON c.id = e.chunk_id
    WHERE c.document_id = ?
    GROUP BY e.provider, e.model, e.dimension
    ORDER BY count DESC, e.provider ASC, e.model ASC
  `).all(documentId);
  const indexed = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  return {
    indexed,
    missing: 0,
    models: rows,
  };
}

function formatPayload(item, document, chunks, annotations = [], embeddingStats = null) {
  const embeddings = embeddingStats || { indexed: 0, missing: chunks.length, models: [] };
  embeddings.missing = Math.max(0, chunks.length - Number(embeddings.indexed || 0));
  return {
    item,
    document,
    chunks,
    annotations,
    embeddings,
    stats: {
      chunk_count: chunks.length,
      token_count: chunks.reduce((sum, chunk) => sum + Number(chunk.token_count || 0), 0),
      markdown_chars: document.markdown.length,
      updated_at: document.updated_at,
    },
  };
}

export function getDocumentInspection(db, { itemId, userId }) {
  const item = getOwnedItem(db, { itemId, userId });
  if (!item) throw new DocumentInspectorError(404, '不存在');

  const document = getDocumentRow(db, item.id);
  if (!document) throw new DocumentInspectorError(404, '文档尚未生成');

  return formatPayload(
    item,
    document,
    getChunkRows(db, document.id),
    getAnnotationRows(db, document.id),
    getEmbeddingStats(db, document.id),
  );
}

export function reindexDocumentInspection(db, { itemId, userId }) {
  const item = getOwnedItem(db, { itemId, userId });
  if (!item) throw new DocumentInspectorError(404, '不存在');

  indexDocumentForItem(db, item.id);
  return getDocumentInspection(db, { itemId: item.id, userId });
}

export function rechunkDocumentInspection(db, { itemId, userId }) {
  const item = getOwnedItem(db, { itemId, userId });
  if (!item) throw new DocumentInspectorError(404, '不存在');

  const document = getDocumentRow(db, item.id);
  if (!document) throw new DocumentInspectorError(404, '文档尚未生成');

  rechunkDocument(db, document.id);
  return getDocumentInspection(db, { itemId: item.id, userId });
}

function buildInspectionAnnotation({ item, document, chunks }) {
  const headingPaths = [...new Set(chunks.map(chunk => chunk.heading_path).filter(Boolean))];
  return {
    title: document.title,
    item_id: item.id,
    source_type: item.type,
    source_url: item.url || '',
    summary: item.summary || '',
    chunk_count: chunks.length,
    token_count: chunks.reduce((sum, chunk) => sum + Number(chunk.token_count || 0), 0),
    chunk_types: chunks.reduce((acc, chunk) => {
      acc[chunk.chunk_type] = (acc[chunk.chunk_type] || 0) + 1;
      return acc;
    }, {}),
    heading_paths: headingPaths.slice(0, 24),
    markdown_hash: document.markdown_hash,
    parser_version: document.parser_version,
  };
}

export function annotateDocumentInspection(db, { itemId, userId }) {
  const payload = getDocumentInspection(db, { itemId, userId });
  const content = buildInspectionAnnotation(payload);

  db.prepare(`
    INSERT INTO document_annotations (document_id, type, content_json, model)
    VALUES (?, 'inspection_summary', ?, 'linkbox-local')
  `).run(payload.document.id, JSON.stringify(content));

  return getDocumentInspection(db, { itemId, userId });
}
