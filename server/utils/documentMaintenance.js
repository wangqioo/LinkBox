import { indexDocumentForItem, initDocumentSchema } from './documentIndex.js';
import { enqueueDocumentEmbedding } from './enrichmentJobs.js';

function contentWhere() {
  return `(
    COALESCE(content_md, '') != ''
    OR COALESCE(content, '') != ''
    OR COALESCE(summary, '') != ''
    OR COALESCE(description, '') != ''
  )`;
}

function aliasedContentWhere(alias) {
  return `(
    COALESCE(${alias}.content_md, '') != ''
    OR COALESCE(${alias}.content, '') != ''
    OR COALESCE(${alias}.summary, '') != ''
    OR COALESCE(${alias}.description, '') != ''
  )`;
}

function countRow(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.count || 0);
}

function embeddingJobCounts(db) {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM jobs
    WHERE type = 'document.embed'
    GROUP BY status
  `).all();
  return {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    ...Object.fromEntries(rows.map(row => [row.status, Number(row.count || 0)])),
  };
}

export function getDocumentMaintenanceStats(db, {
  provider = 'local',
  model = 'linkbox-local-hash-v1',
} = {}) {
  initDocumentSchema(db);
  const itemsWithContent = countRow(db, `SELECT COUNT(*) AS count FROM links WHERE ${contentWhere()}`);
  const documents = countRow(db, 'SELECT COUNT(*) AS count FROM documents');
  const chunks = countRow(db, 'SELECT COUNT(*) AS count FROM document_chunks');
  const embeddings = countRow(db, 'SELECT COUNT(*) AS count FROM document_embeddings');
  const missingDocuments = countRow(db, `
    SELECT COUNT(*) AS count
    FROM links l
    LEFT JOIN documents d ON d.item_id = l.id
    WHERE d.id IS NULL AND ${aliasedContentWhere('l')}
  `);
  const missingEmbeddings = countRow(db, `
    SELECT COUNT(*) AS count
    FROM document_chunks c
    LEFT JOIN document_embeddings e
      ON e.chunk_id = c.id
      AND e.provider = ?
      AND e.model = ?
      AND e.content_hash = c.content_hash
    WHERE e.id IS NULL
  `, provider, model);

  return {
    items_with_content: itemsWithContent,
    documents,
    missing_documents: missingDocuments,
    chunks,
    embeddings,
    missing_embeddings: missingEmbeddings,
    embedding_target: {
      provider,
      model,
    },
    embedding_jobs: embeddingJobCounts(db),
  };
}

export function reindexAllDocuments(db, { limit = 1000 } = {}) {
  initDocumentSchema(db);
  const rows = db.prepare(`
    SELECT id
    FROM links
    WHERE ${contentWhere()}
    ORDER BY imported_at DESC, id DESC
    LIMIT ?
  `).all(limit);

  let chunks = 0;
  for (const row of rows) {
    chunks += indexDocumentForItem(db, row.id).chunkCount;
  }
  return { documents: rows.length, chunks };
}

export function backfillMissingDocumentEmbeddings(db, queue, {
  limit = 500,
  provider = 'local',
  model = 'linkbox-local-hash-v1',
} = {}) {
  initDocumentSchema(db);
  const rows = db.prepare(`
    SELECT DISTINCT d.item_id AS link_id
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    LEFT JOIN document_embeddings e
      ON e.chunk_id = c.id
      AND e.provider = ?
      AND e.model = ?
      AND e.content_hash = c.content_hash
    WHERE e.id IS NULL
    ORDER BY d.item_id ASC
    LIMIT ?
  `).all(provider, model, limit);

  let enqueued = 0;
  for (const row of rows) {
    if (enqueueDocumentEmbedding(db, queue, row.link_id)) enqueued += 1;
  }
  return { enqueued };
}
