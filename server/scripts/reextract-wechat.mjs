import db from '../db.js';
import { extractPageMarkdown } from '../utils/extractContent.js';
import { indexLinkContent, removeLinkContentIndex } from '../utils/chunkIndex.js';

const rows = db.prepare(`
  SELECT id, title, url
  FROM links
  WHERE url LIKE '%mp.weixin.qq.com%' OR url LIKE '%weixin.qq.com%'
  ORDER BY id DESC
`).all();

console.log(`[wechat] found ${rows.length} article(s)`);

let ok = 0;
let failed = 0;

for (const row of rows) {
  process.stdout.write(`[wechat] ${row.id} ${row.title || row.url} ... `);
  try {
    db.prepare("UPDATE links SET status = 'processing' WHERE id = ?").run(row.id);
    const result = await extractPageMarkdown(row.url);
    db.prepare(`
      UPDATE links
      SET title = COALESCE(NULLIF(?, ''), title),
          content_md = ?,
          status = 'done'
      WHERE id = ?
    `).run(result.title || '', result.markdown || '', row.id);
    removeLinkContentIndex(row.id);
    indexLinkContent(row.id);
    ok += 1;
    console.log(`ok (${(result.markdown || '').length} chars)`);
  } catch (error) {
    failed += 1;
    db.prepare("UPDATE links SET status = 'error' WHERE id = ?").run(row.id);
    console.log(`failed: ${error.message}`);
  }
}

console.log(`[wechat] done: ${ok} ok, ${failed} failed`);
