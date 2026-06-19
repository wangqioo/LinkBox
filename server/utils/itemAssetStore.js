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
