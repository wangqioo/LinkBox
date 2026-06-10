import { attachProcessingStatus } from './itemProcessingStatus.js';
import { buildLinkListQuery } from './linkListQuery.js';

export function attachTags(db, linkId) {
  return db.prepare('SELECT t.* FROM tags t JOIN link_tags lt ON t.id = lt.tag_id WHERE lt.link_id = ?').all(linkId);
}

export function listItemsForUser(db, { userId, query = {} }) {
  const { sql, countSql, params, countParams, page, limit } = buildLinkListQuery({
    userId,
    query,
  });

  const links = db.prepare(sql).all(...params);
  const { total } = db.prepare(countSql).get(...countParams);
  const result = attachProcessingStatus(
    db,
    links.map(link => ({ ...link, tags: attachTags(db, link.id) })),
  );

  return { links: result, total, page, limit };
}

export function getItemForUser(db, { linkId, userId }) {
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(linkId, userId);
  if (!link) return null;
  return attachProcessingStatus(db, { ...link, tags: attachTags(db, link.id) });
}

export function getItemById(db, linkId) {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
  if (!link) return null;
  return attachProcessingStatus(db, { ...link, tags: attachTags(db, link.id) });
}
