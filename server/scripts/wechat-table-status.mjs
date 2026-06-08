import db from '../db.js';

const rows = db.prepare(`
  SELECT id, title,
         LENGTH(COALESCE(content_md, '')) AS len,
         CASE WHEN content_md LIKE '%data-linkbox-table%' THEN 1 ELSE 0 END AS has_table_marker,
         CASE WHEN content_md LIKE '%<table%' THEN 1 ELSE 0 END AS has_table
  FROM links
  WHERE url LIKE '%mp.weixin.qq.com%' OR url LIKE '%weixin.qq.com%'
  ORDER BY id DESC
`).all();

console.log(JSON.stringify(rows, null, 2));
