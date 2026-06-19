import { createHash } from 'crypto';

export function itemContentHash(content = {}) {
  return createHash('sha256').update(JSON.stringify({
    text_content: content.text_content || '',
    extracted_markdown: content.extracted_markdown || '',
    summary: content.summary || '',
    html_note: content.html_note || '',
  })).digest('hex');
}

function normalizeContentRow(row, source) {
  if (!row) return null;
  const content = {
    item_id: row.item_id ?? row.id,
    user_id: row.user_id,
    text_content: row.text_content ?? row.content ?? '',
    extracted_markdown: row.extracted_markdown ?? row.content_md ?? '',
    summary: row.summary || '',
    html_note: row.html_note || '',
    content_hash: row.content_hash || '',
    source,
  };
  if (!content.content_hash) content.content_hash = itemContentHash(content);
  return content;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

export function hasItemContentSchema(db) {
  if (!db) throw new Error('hasItemContentSchema requires a database');
  return tableExists(db, 'item_content');
}

export function initItemContentSchema(db) {
  if (!db) throw new Error('initItemContentSchema requires a database');
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_content (
      item_id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      text_content TEXT DEFAULT '',
      extracted_markdown TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      html_note TEXT DEFAULT '',
      content_hash TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_content_user ON item_content(user_id);
  `);
}

export function backfillItemContent(db) {
  if (!db) throw new Error('backfillItemContent requires a database');
  initItemContentSchema(db);

  const rows = db.prepare(`
    SELECT id, user_id, content, content_md, summary, html_note
    FROM links
    WHERE COALESCE(content, '') != ''
      OR COALESCE(content_md, '') != ''
      OR COALESCE(summary, '') != ''
      OR COALESCE(html_note, '') != ''
  `).all();
  const insert = db.prepare(`
    INSERT INTO item_content (
      item_id, user_id, text_content, extracted_markdown, summary, html_note,
      content_hash, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT imported_at FROM links WHERE id = ?), datetime('now')))
    ON CONFLICT(item_id) DO NOTHING
  `);
  const tx = db.transaction(() => {
    for (const row of rows) {
      const content = {
        text_content: row.content || '',
        extracted_markdown: row.content_md || '',
        summary: row.summary || '',
        html_note: row.html_note || '',
      };
      insert.run(
        row.id,
        row.user_id,
        content.text_content,
        content.extracted_markdown,
        content.summary,
        content.html_note,
        itemContentHash(content),
        row.id,
      );
    }
  });
  tx();
  return { rows: rows.length };
}

export function upsertItemContent(db, itemId, fields = {}) {
  if (!db) throw new Error('upsertItemContent requires a database');
  if (!hasItemContentSchema(db)) return null;

  const existing = getItemContent(db, itemId) || {};
  const columns = tableColumns(db, 'links');
  const select = [
    'id',
    'user_id',
    columns.has('content') ? 'content' : "'' AS content",
    columns.has('content_md') ? 'content_md' : "'' AS content_md",
    columns.has('summary') ? 'summary' : "'' AS summary",
    columns.has('html_note') ? 'html_note' : "'' AS html_note",
  ].join(', ');
  const link = db.prepare(`SELECT ${select} FROM links WHERE id = ?`).get(itemId);
  if (!link) return null;
  const content = {
    text_content: fields.text_content ?? fields.content ?? existing.text_content ?? '',
    extracted_markdown: fields.extracted_markdown ?? fields.content_md ?? existing.extracted_markdown ?? '',
    summary: fields.summary ?? existing.summary ?? '',
    html_note: fields.html_note ?? existing.html_note ?? '',
  };
  const hasContent = Object.values(content).some(value => String(value || '').trim());
  if (!hasContent) return null;
  const hash = itemContentHash(content);
  db.prepare(`
    INSERT INTO item_content (
      item_id, user_id, text_content, extracted_markdown, summary, html_note,
      content_hash, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(item_id) DO UPDATE SET
      user_id = excluded.user_id,
      text_content = excluded.text_content,
      extracted_markdown = excluded.extracted_markdown,
      summary = excluded.summary,
      html_note = excluded.html_note,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at
  `).run(
    link.id,
    link.user_id,
    content.text_content,
    content.extracted_markdown,
    content.summary,
    content.html_note,
    hash,
  );
  return { item_id: link.id, user_id: link.user_id, ...content, content_hash: hash };
}

export function getItemContent(db, itemId) {
  if (!db) throw new Error('getItemContent requires a database');
  if (tableExists(db, 'item_content')) {
    const stored = db.prepare(`
      SELECT item_id, user_id, text_content, extracted_markdown, summary, html_note, content_hash
      FROM item_content
      WHERE item_id = ?
    `).get(itemId);
    if (stored) return normalizeContentRow(stored, 'item_content');
  }

  const columns = tableColumns(db, 'links');
  const select = [
    'id',
    'user_id',
    columns.has('content') ? 'content' : "'' AS content",
    columns.has('content_md') ? 'content_md' : "'' AS content_md",
    columns.has('summary') ? 'summary' : "'' AS summary",
    columns.has('html_note') ? 'html_note' : "'' AS html_note",
  ].join(', ');
  const legacy = db.prepare(`
    SELECT ${select}
    FROM links
    WHERE id = ?
  `).get(itemId);
  return normalizeContentRow(legacy, 'links');
}

export function attachItemContent(db, item) {
  if (!item) return item;
  const content = getItemContent(db, item.id);
  if (!content) return item;
  return {
    ...item,
    content: content.text_content,
    content_md: content.extracted_markdown,
    summary: content.summary,
    html_note: content.html_note,
    item_content: content,
  };
}
