import { sqlConditionForItemKind } from './itemKind.js';

function numeric(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function addTypeCondition({ conditions, params, type }) {
  if (!type) return;
  const condition = sqlConditionForItemKind(String(type), '');
  conditions.push(condition.sql);
  params.push(...condition.params);
}

export function buildMobileFilesListQuery({ userId, query = {} }) {
  const params = [userId];
  const conditions = ["user_id = ?", "COALESCE(scope, 'personal') = 'personal'"];

  if (query.date) {
    conditions.push('substr(imported_at, 1, 10) = ?');
    params.push(String(query.date));
  }

  addTypeCondition({ conditions, params, type: query.type });

  params.push(numeric(query.limit, 500), numeric(query.offset, 0));

  return {
    sql: `
    SELECT * FROM links
    WHERE ${conditions.join(' AND ')}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `,
    params,
  };
}

export function buildMobileFilesSearchQuery({ userId, query = {} }) {
  const q = String(query.q || '').trim();
  const params = [userId];
  const conditions = ["user_id = ?", "COALESCE(scope, 'personal') = 'personal'"];

  if (query.date) {
    conditions.push('substr(imported_at, 1, 10) = ?');
    params.push(String(query.date));
  }

  addTypeCondition({ conditions, params, type: query.type });

  const like = `%${q}%`;
  conditions.push('(title LIKE ? OR url LIKE ? OR description LIKE ? OR content LIKE ? OR content_md LIKE ? OR summary LIKE ?)');
  params.push(like, like, like, like, like, like);

  return {
    sql: `
    SELECT * FROM links
    WHERE ${conditions.join(' AND ')}
    ORDER BY id DESC
    LIMIT 50
  `,
    params,
    q,
  };
}
