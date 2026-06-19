import { basename } from 'path';

const UPLOAD_PREFIX = '/uploads/';
const SIZE_UNITS = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

function isOwnedUploadPath(path = '') {
  return String(path || '').startsWith(UPLOAD_PREFIX);
}

function filenameFromPath(path = '') {
  return basename(String(path || '')) || '';
}

function sizeFromDescription(description = '') {
  const match = String(description || '').match(/\(([\d.]+)\s*(B|KB|MB|GB)\)$/i);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = SIZE_UNITS[match[2].toUpperCase()];
  if (!Number.isFinite(value) || !unit) return 0;
  return Math.round(value * unit);
}

function kindForRow(row) {
  if (row.type === 'image') return 'image';
  if (row.type === 'audio') return 'audio';
  return 'file';
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

export function hasItemAssetSchema(db) {
  if (!db) throw new Error('hasItemAssetSchema requires a database');
  return tableExists(db, 'item_assets');
}

export function initItemAssetSchema(db) {
  if (!db) throw new Error('initItemAssetSchema requires a database');
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      public_path TEXT NOT NULL,
      disk_path TEXT DEFAULT '',
      original_name TEXT DEFAULT '',
      mime_type TEXT DEFAULT '',
      size_bytes INTEGER DEFAULT 0,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE,
      UNIQUE(item_id, kind, public_path)
    );
    CREATE INDEX IF NOT EXISTS idx_item_assets_item ON item_assets(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_assets_user ON item_assets(user_id);
  `);
}

export function backfillItemAssets(db) {
  if (!db) throw new Error('backfillItemAssets requires a database');
  initItemAssetSchema(db);

  const rows = db.prepare(`
    SELECT id, user_id, type, title, description, thumbnail, image_path, imported_at, created_at
    FROM links
    WHERE COALESCE(image_path, '') != ''
      OR COALESCE(thumbnail, '') != ''
  `).all();
  const insert = db.prepare(`
    INSERT INTO item_assets (
      item_id, user_id, kind, public_path, disk_path, original_name, mime_type,
      size_bytes, metadata_json, created_at
    )
    VALUES (?, ?, ?, ?, '', ?, '', ?, ?, COALESCE(?, datetime('now')))
    ON CONFLICT(item_id, kind, public_path) DO NOTHING
  `);
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (isOwnedUploadPath(row.image_path)) {
        const originalName = filenameFromPath(row.image_path);
        insert.run(
          row.id,
          row.user_id,
          kindForRow(row),
          row.image_path,
          originalName,
          sizeFromDescription(row.description),
          JSON.stringify({ source: 'links.image_path' }),
          row.imported_at || row.created_at || null,
        );
      }
      if (
        isOwnedUploadPath(row.thumbnail)
        && row.thumbnail !== row.image_path
      ) {
        const originalName = filenameFromPath(row.thumbnail);
        insert.run(
          row.id,
          row.user_id,
          'thumbnail',
          row.thumbnail,
          originalName,
          0,
          JSON.stringify({ source: 'links.thumbnail' }),
          row.imported_at || row.created_at || null,
        );
      }
    }
  });
  tx();
  return { rows: rows.length };
}

export function upsertItemAsset(db, itemId, {
  kind,
  publicPath,
  diskPath = '',
  originalName = '',
  mimeType = '',
  sizeBytes = 0,
  metadata = {},
} = {}) {
  if (!db) throw new Error('upsertItemAsset requires a database');
  if (!hasItemAssetSchema(db)) return null;
  if (!isOwnedUploadPath(publicPath)) return null;
  const columns = tableColumns(db, 'links');
  const select = [
    'id',
    'user_id',
    columns.has('type') ? 'type' : "'file' AS type",
    columns.has('imported_at') ? 'imported_at' : 'NULL AS imported_at',
    columns.has('created_at') ? 'created_at' : 'NULL AS created_at',
  ].join(', ');
  const link = db.prepare(`SELECT ${select} FROM links WHERE id = ?`).get(itemId);
  if (!link) return null;
  const resolvedKind = kind || kindForRow(link);
  const resolvedOriginalName = originalName || filenameFromPath(publicPath);
  const resolvedSize = Number(sizeBytes) || 0;
  db.prepare(`
    INSERT INTO item_assets (
      item_id, user_id, kind, public_path, disk_path, original_name, mime_type,
      size_bytes, metadata_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    ON CONFLICT(item_id, kind, public_path) DO UPDATE SET
      user_id = excluded.user_id,
      disk_path = excluded.disk_path,
      original_name = excluded.original_name,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      metadata_json = excluded.metadata_json
  `).run(
    link.id,
    link.user_id,
    resolvedKind,
    publicPath,
    diskPath || '',
    resolvedOriginalName,
    mimeType || '',
    resolvedSize,
    JSON.stringify(metadata || {}),
    link.imported_at || link.created_at || null,
  );
  return {
    item_id: link.id,
    user_id: link.user_id,
    kind: resolvedKind,
    public_path: publicPath,
    disk_path: diskPath || '',
    original_name: resolvedOriginalName,
    mime_type: mimeType || '',
    size_bytes: resolvedSize,
    metadata_json: JSON.stringify(metadata || {}),
  };
}
