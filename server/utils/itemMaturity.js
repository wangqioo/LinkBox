function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnExists(db, table, column) {
  if (!tableExists(db, table)) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function hasRow(db, sql, ...params) {
  return Boolean(db.prepare(sql).get(...params));
}

function itemRow(db, itemId) {
  return db.prepare('SELECT * FROM links WHERE id = ?').get(itemId);
}

export function deriveItemMaturity(db, itemId) {
  if (!db) throw new Error('deriveItemMaturity requires a database');
  const item = itemRow(db, itemId);
  if (!item) throw new Error('Item not found');

  const hasContent = Boolean(
    item.content_md || item.content || item.description || item.summary || item.html_note || item.image_path,
  );
  const hasSummary = Boolean(String(item.summary || '').trim());
  const hasDocument = tableExists(db, 'documents') && hasRow(db, 'SELECT id FROM documents WHERE item_id = ? LIMIT 1', itemId);
  const hasChunks = tableExists(db, 'documents') && tableExists(db, 'document_chunks') && hasRow(db, `
    SELECT c.id
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.item_id = ?
    LIMIT 1
  `, itemId);
  const hasUnderstanding = tableExists(db, 'item_understanding_runs')
    && hasRow(db, 'SELECT item_id FROM item_understanding_runs WHERE item_id = ? LIMIT 1', itemId);
  const hasPendingSuggestion = tableExists(db, 'agent_suggestions')
    && hasRow(db, "SELECT id FROM agent_suggestions WHERE item_id = ? AND status = 'pending' LIMIT 1", itemId);
  const hasFailedJob = tableExists(db, 'jobs')
    && columnExists(db, 'jobs', 'link_id')
    && hasRow(db, "SELECT id FROM jobs WHERE link_id = ? AND status = 'failed' LIMIT 1", itemId);

  let state = 'raw';
  if (hasContent) state = 'converted';
  if (hasChunks) state = 'indexed';
  if (hasUnderstanding) state = 'understood';
  if (hasSummary && (state === 'converted' || state === 'indexed' || state === 'understood')) state = 'summarized';
  if (hasPendingSuggestion || hasFailedJob) state = 'review_needed';

  return {
    itemId,
    state,
    flags: {
      hasContent,
      hasDocument,
      hasChunks,
      hasUnderstanding,
      hasSummary,
      hasPendingSuggestion,
      hasFailedJob,
    },
  };
}

export function getMaturityCoverage(db, { userId = 1, limit = 5000 } = {}) {
  if (!db) throw new Error('getMaturityCoverage requires a database');
  const rows = db.prepare(`
    SELECT id
    FROM links
    WHERE user_id = ?
    ORDER BY datetime(imported_at) DESC, id DESC
    LIMIT ?
  `).all(userId, Math.max(1, Math.min(20000, Number(limit) || 5000)));

  const states = {
    raw: 0,
    converted: 0,
    indexed: 0,
    understood: 0,
    summarized: 0,
    review_needed: 0,
    reviewed: 0,
  };
  const items = rows.map((row) => {
    const maturity = deriveItemMaturity(db, row.id);
    states[maturity.state] = (states[maturity.state] || 0) + 1;
    return maturity;
  });

  return {
    total: rows.length,
    states,
    reviewNeeded: states.review_needed,
    ready: states.indexed + states.understood + states.summarized,
    items,
  };
}
