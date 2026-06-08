import db from '../db.js';

const rows = db.prepare(`
  SELECT id, title, status, LENGTH(COALESCE(content_md, '')) AS len
  FROM links
  WHERE url LIKE '%mp.weixin.qq.com%' OR url LIKE '%weixin.qq.com%'
  ORDER BY id DESC
`).all();

console.log(JSON.stringify(rows, null, 2));
