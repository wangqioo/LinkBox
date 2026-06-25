import { indexDocumentForItem, initDocumentSchema } from './documentIndex.js';
import { enqueueDocumentEmbedding } from './enrichmentJobs.js';
import { initItemUnderstandingSchema, upsertItemUnderstanding } from './itemUnderstanding.js';

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

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
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

function sampleItem(row) {
  return {
    id: row.id,
    type: row.type || '',
    title: row.title || row.url || `Item ${row.id}`,
  };
}

function contentRowWhere(alias) {
  return `(
    COALESCE(${alias}.content_md, '') != ''
    OR COALESCE(${alias}.content, '') != ''
    OR COALESCE(${alias}.summary, '') != ''
    OR COALESCE(${alias}.html_note, '') != ''
  )`;
}

function missingDocumentsReport(db, limit) {
  const count = countRow(db, `
    SELECT COUNT(*) AS count
    FROM links l
    LEFT JOIN documents d ON d.item_id = l.id
    WHERE d.id IS NULL AND ${aliasedContentWhere('l')}
  `);
  const samples = db.prepare(`
    SELECT l.id, l.type, l.title, l.url
    FROM links l
    LEFT JOIN documents d ON d.item_id = l.id
    WHERE d.id IS NULL AND ${aliasedContentWhere('l')}
    ORDER BY datetime(l.imported_at) DESC, l.id DESC
    LIMIT ?
  `).all(limit).map(sampleItem);
  return { count, samples };
}

function missingContentRowsReport(db, limit) {
  if (!tableExists(db, 'item_content')) {
    const count = countRow(db, `SELECT COUNT(*) AS count FROM links l WHERE ${contentRowWhere('l')}`);
    const samples = db.prepare(`
      SELECT l.id, l.type, l.title, l.url
      FROM links l
      WHERE ${contentRowWhere('l')}
      ORDER BY datetime(l.imported_at) DESC, l.id DESC
      LIMIT ?
    `).all(limit).map(sampleItem);
    return { count, samples };
  }
  const count = countRow(db, `
    SELECT COUNT(*) AS count
    FROM links l
    LEFT JOIN item_content c ON c.item_id = l.id
    WHERE c.item_id IS NULL AND ${contentRowWhere('l')}
  `);
  const samples = db.prepare(`
    SELECT l.id, l.type, l.title, l.url
    FROM links l
    LEFT JOIN item_content c ON c.item_id = l.id
    WHERE c.item_id IS NULL AND ${contentRowWhere('l')}
    ORDER BY datetime(l.imported_at) DESC, l.id DESC
    LIMIT ?
  `).all(limit).map(sampleItem);
  return { count, samples };
}

function expectedAssetRowsCte() {
  return `
    WITH expected_assets AS (
      SELECT id, user_id, type, title, url, image_path AS public_path,
        CASE
          WHEN type = 'image' THEN 'image'
          WHEN type = 'audio' THEN 'audio'
          ELSE 'file'
        END AS kind,
        imported_at
      FROM links
      WHERE COALESCE(image_path, '') LIKE '/uploads/%'
      UNION ALL
      SELECT id, user_id, type, title, url, thumbnail AS public_path, 'thumbnail' AS kind, imported_at
      FROM links
      WHERE COALESCE(thumbnail, '') LIKE '/uploads/%'
        AND thumbnail != COALESCE(image_path, '')
    )
  `;
}

function missingAssetRowsReport(db, limit) {
  if (!tableExists(db, 'item_assets')) {
    const count = countRow(db, `
      ${expectedAssetRowsCte()}
      SELECT COUNT(*) AS count FROM expected_assets
    `);
    const samples = db.prepare(`
      ${expectedAssetRowsCte()}
      SELECT id, type, title, url, kind, public_path
      FROM expected_assets
      ORDER BY datetime(imported_at) DESC, id DESC, kind ASC
      LIMIT ?
    `).all(limit).map(row => ({ ...sampleItem(row), kind: row.kind, public_path: row.public_path }));
    return { count, samples };
  }
  const count = countRow(db, `
    ${expectedAssetRowsCte()}
    SELECT COUNT(*) AS count
    FROM expected_assets e
    LEFT JOIN item_assets a
      ON a.item_id = e.id
      AND a.kind = e.kind
      AND a.public_path = e.public_path
    WHERE a.id IS NULL
  `);
  const samples = db.prepare(`
    ${expectedAssetRowsCte()}
    SELECT e.id, e.type, e.title, e.url, e.kind, e.public_path
    FROM expected_assets e
    LEFT JOIN item_assets a
      ON a.item_id = e.id
      AND a.kind = e.kind
      AND a.public_path = e.public_path
    WHERE a.id IS NULL
    ORDER BY datetime(e.imported_at) DESC, e.id DESC, e.kind ASC
    LIMIT ?
  `).all(limit).map(row => ({ ...sampleItem(row), kind: row.kind, public_path: row.public_path }));
  return { count, samples };
}

function itemUnderstandingSummary(db) {
  initItemUnderstandingSchema(db);
  const itemsWithContent = countRow(db, `SELECT COUNT(*) AS count FROM links WHERE ${contentWhere()}`);
  const processedItems = countRow(db, 'SELECT COUNT(*) AS count FROM item_understanding_runs');
  return {
    items_with_content: itemsWithContent,
    processed_items: processedItems,
    missing_items: Math.max(0, itemsWithContent - processedItems),
    entities: countRow(db, 'SELECT COUNT(*) AS count FROM item_entities'),
    topics: countRow(db, 'SELECT COUNT(*) AS count FROM item_topics'),
    todos: countRow(db, 'SELECT COUNT(*) AS count FROM item_todos'),
    claims: countRow(db, 'SELECT COUNT(*) AS count FROM item_claims'),
  };
}

export function getStorageConsistencyReport(db, { sampleLimit = 5 } = {}) {
  initDocumentSchema(db);
  const limit = Math.max(1, Math.min(20, Number(sampleLimit) || 5));
  return {
    missing_documents: missingDocumentsReport(db, limit),
    missing_content_rows: missingContentRowsReport(db, limit),
    missing_asset_rows: missingAssetRowsReport(db, limit),
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
    item_understanding: itemUnderstandingSummary(db),
    consistency: getStorageConsistencyReport(db),
  };
}

export function backfillItemUnderstanding(db, { limit = 500 } = {}) {
  initItemUnderstandingSchema(db);
  const rows = db.prepare(`
    SELECT l.id
    FROM links l
    LEFT JOIN item_understanding_runs r ON r.item_id = l.id
    WHERE r.item_id IS NULL
      AND ${aliasedContentWhere('l')}
    ORDER BY datetime(l.imported_at) DESC, l.id DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(5000, Number(limit) || 500)));

  const totals = {
    items: 0,
    entities: 0,
    topics: 0,
    todos: 0,
    claims: 0,
  };
  for (const row of rows) {
    const understanding = upsertItemUnderstanding(db, row.id);
    totals.items += 1;
    totals.entities += understanding.entities.length;
    totals.topics += understanding.topics.length;
    totals.todos += understanding.todos.length;
    totals.claims += understanding.claims.length;
  }
  return totals;
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
