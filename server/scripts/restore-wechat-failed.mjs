import db from '../db.js';
import { indexLinkContent, removeLinkContentIndex } from '../utils/chunkIndex.js';

const rows = db.prepare(`
  SELECT id, title, LENGTH(COALESCE(content_md, '')) AS len
  FROM links
  WHERE status = 'error'
    AND (url LIKE '%mp.weixin.qq.com%' OR url LIKE '%weixin.qq.com%')
    AND COALESCE(content_md, '') != ''
`).all();

for (const row of rows) {
  db.prepare("UPDATE links SET status = 'done' WHERE id = ?").run(row.id);
  removeLinkContentIndex(row.id);
  indexLinkContent(row.id);
  console.log(`[wechat] restored ${row.id} ${row.title || ''} (${row.len} chars)`);
}

console.log(`[wechat] restored ${rows.length} failed article(s) with existing content`);
