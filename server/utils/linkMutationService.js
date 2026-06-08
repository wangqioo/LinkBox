import { attachTags, setTags } from './linkCreateService.js';

export class LinkMutationError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'LinkMutationError';
    this.status = status;
  }
}

export function updateLinkItem(db, {
  linkId,
  userId,
  title,
  comment,
  content,
  importedAt,
  tagIds,
}) {
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(linkId, userId);
  if (!link) throw new LinkMutationError(404, '不存在');

  db.prepare(`
    UPDATE links SET title = COALESCE(?, title), comment = COALESCE(?, comment),
    content = COALESCE(?, content), imported_at = COALESCE(?, imported_at) WHERE id = ?
  `).run(title ?? null, comment ?? null, content ?? null, importedAt ?? null, linkId);

  if (tagIds !== undefined) setTags(db, linkId, tagIds);

  const updated = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
  return { link: { ...updated, tags: attachTags(db, updated.id) } };
}

export function deleteLinkItem(db, { linkId, userId, removeIndex = () => {} }) {
  removeIndex(linkId);
  const result = db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(linkId, userId);
  if (result.changes === 0) throw new LinkMutationError(404, '不存在');
  return { ok: true };
}
