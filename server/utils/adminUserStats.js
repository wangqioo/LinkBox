import { itemKindForRow } from './itemKind.js';

export const ADMIN_ITEM_TYPE_KEYS = ['link', 'article', 'video', 'text', 'image', 'audio', 'document'];

export function emptyAdminTypeStats() {
  return Object.fromEntries(ADMIN_ITEM_TYPE_KEYS.map(key => [key, 0]));
}

export function summarizeAdminItemRows(rows = []) {
  const byType = emptyAdminTypeStats();
  let processingCount = 0;
  let errorCount = 0;
  let lastUsedAt = null;

  for (const row of rows) {
    const kind = itemKindForRow(row);
    byType[kind] = (byType[kind] || 0) + 1;
    if (row.status === 'processing') processingCount += 1;
    if (row.status === 'error') errorCount += 1;
    if (row.imported_at && (!lastUsedAt || String(row.imported_at) > String(lastUsedAt))) {
      lastUsedAt = row.imported_at;
    }
  }

  return {
    item_count: rows.length,
    processing_count: processingCount,
    error_count: errorCount,
    last_used_at: lastUsedAt,
    by_type: byType,
  };
}

export function presentAdminRecentItem(row = {}) {
  return {
    ...row,
    type: itemKindForRow(row),
    stored_type: row.type || 'link',
  };
}
