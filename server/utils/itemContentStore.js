import { createHash } from 'crypto';

export function itemContentHash(content = {}) {
  return createHash('sha256').update(JSON.stringify({
    text_content: content.text_content || '',
    extracted_markdown: content.extracted_markdown || '',
    summary: content.summary || '',
    html_note: content.html_note || '',
  })).digest('hex');
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
