export function ensureGroupMember(database, groupId, userId) {
  return database.prepare(`
    SELECT gm.role, g.name, g.owner_id, g.agent_name
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.group_id = ? AND gm.user_id = ?
  `).get(groupId, userId) || null;
}

export function areFriends(database, userId, otherId) {
  return Boolean(database.prepare(`
    SELECT 1 FROM friendships
    WHERE status = 'accepted'
      AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
  `).get(userId, otherId, otherId, userId));
}

export function requireAcceptedFriend(database, userId, otherId) {
  if (!otherId || otherId === userId) return null;
  const friendship = database.prepare(`
    SELECT 1 FROM friendships
    WHERE status = 'accepted'
      AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
  `).get(userId, otherId, otherId, userId);
  if (!friendship) return null;
  return database.prepare('SELECT id, username FROM users WHERE id = ?').get(otherId) || null;
}

export function currentIsoTime() {
  return new Date().toISOString();
}

export function toUtcIsoTime(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return new Date(`${text.replace(' ', 'T')}Z`).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Date(`${text}T00:00:00Z`).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

export function directMessagePayload(row) {
  return {
    ...row,
    created_at: toUtcIsoTime(row.created_at),
    user: { id: row.user_id, username: row.username },
  };
}

export function groupMessagePayload(row) {
  return {
    ...row,
    created_at: toUtcIsoTime(row.created_at),
    user: { id: row.user_id, username: row.username },
  };
}

export function materialPayload(link, { file = null } = {}) {
  return {
    link_id: link.id,
    title: link.title || link.url || `资料 ${link.id}`,
    summary: link.summary || link.description || '',
    type: link.type,
    url: link.url,
    file,
  };
}
