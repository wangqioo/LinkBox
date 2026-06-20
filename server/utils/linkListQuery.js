import { sqlConditionForItemKind } from './itemKind.js';

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildLinkListQuery({ userId, query = {} }) {
  const { tag, search, from, to, type } = query;
  const page = positiveInt(query.page, 1);
  const limit = positiveInt(query.limit, 50);

  let sql = `SELECT DISTINCT l.id, l.user_id, l.type, l.url, l.title, l.description,
    l.thumbnail, l.comment, l.content, l.image_path, l.imported_at, l.created_at,
    l.summary, l.status,
    CASE WHEN l.content_md IS NOT NULL AND l.content_md != '' THEN 1 ELSE 0 END AS has_content_md,
    CASE WHEN l.html_note IS NOT NULL AND l.html_note != '' THEN 1 ELSE 0 END AS has_html_note
    FROM links l`;
  let countSql = `SELECT COUNT(DISTINCT l.id) as total FROM links l`;
  const params = [userId];
  const conditions = ['l.user_id = ?'];

  if (tag) {
    sql += ` JOIN link_tags lt ON l.id = lt.link_id JOIN tags t ON lt.tag_id = t.id`;
    countSql += ` JOIN link_tags lt ON l.id = lt.link_id JOIN tags t ON lt.tag_id = t.id`;
    conditions.push('t.id = ?');
    params.push(tag);
  }

  if (type === 'video') {
    const condition = sqlConditionForItemKind('video', 'l');
    conditions.push(condition.sql);
    params.push(...condition.params);
  } else if (type) {
    const condition = sqlConditionForItemKind(type, 'l');
    conditions.push(condition.sql);
    params.push(...condition.params);
  }

  if (search) {
    conditions.push(`(l.title LIKE ? OR l.url LIKE ? OR l.comment LIKE ? OR l.content LIKE ?)`);
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  if (from) {
    conditions.push('l.imported_at >= ?');
    params.push(from);
  }

  if (to) {
    conditions.push('l.imported_at <= ?');
    params.push(to + ' 23:59:59');
  }

  const where = ' WHERE ' + conditions.join(' AND ');
  sql += where + ` ORDER BY l.imported_at DESC LIMIT ? OFFSET ?`;
  countSql += where;

  const offset = (page - 1) * limit;
  const countParams = [...params];
  params.push(limit, offset);

  return { sql, countSql, params, countParams, page, limit };
}
