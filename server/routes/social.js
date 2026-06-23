import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

function ensureGroupMember(groupId, userId) {
  return db.prepare(`
    SELECT gm.role, g.name, g.owner_id, g.agent_name
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.group_id = ? AND gm.user_id = ?
  `).get(groupId, userId) || null;
}

function areFriends(userId, otherId) {
  return !!db.prepare(`
    SELECT 1 FROM friendships
    WHERE status = 'accepted'
      AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
  `).get(userId, otherId, otherId, userId);
}

router.get('/users/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const rows = db.prepare(`
    SELECT id, username
    FROM users
    WHERE id != ? AND username LIKE ?
    ORDER BY username ASC
    LIMIT 12
  `).all(req.userId, `%${q}%`);
  res.json(rows);
});

router.get('/friends', (req, res) => {
  const rows = db.prepare(`
    SELECT f.id, f.requester_id, f.addressee_id, f.status, f.created_at, f.updated_at,
      requester.username AS requester_username,
      addressee.username AS addressee_username
    FROM friendships f
    JOIN users requester ON requester.id = f.requester_id
    JOIN users addressee ON addressee.id = f.addressee_id
    WHERE f.requester_id = ? OR f.addressee_id = ?
    ORDER BY f.updated_at DESC, f.created_at DESC
  `).all(req.userId, req.userId);

  res.json(rows.map(row => ({
    id: row.id,
    status: row.status,
    direction: row.requester_id === req.userId ? 'outgoing' : 'incoming',
    created_at: row.created_at,
    updated_at: row.updated_at,
    user: row.requester_id === req.userId
      ? { id: row.addressee_id, username: row.addressee_username }
      : { id: row.requester_id, username: row.requester_username },
  })));
});

router.post('/friends', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const addresseeId = Number(req.body?.user_id || 0);
  const target = addresseeId
    ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(addresseeId)
    : db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.userId) return res.status(400).json({ error: 'Cannot add yourself as a friend' });

  const existing = db.prepare(`
    SELECT * FROM friendships
    WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
  `).get(req.userId, target.id, target.id, req.userId);

  if (existing?.status === 'accepted') return res.json({ ok: true, status: 'accepted', user: target });
  if (existing?.status === 'pending' && existing.addressee_id === req.userId) {
    db.prepare("UPDATE friendships SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(existing.id);
    return res.json({ ok: true, status: 'accepted', user: target });
  }
  if (existing?.status === 'pending') return res.json({ ok: true, status: 'pending', user: target });

  db.prepare(`
    INSERT INTO friendships (requester_id, addressee_id, status, updated_at)
    VALUES (?, ?, 'pending', datetime('now'))
  `).run(req.userId, target.id);
  res.status(201).json({ ok: true, status: 'pending', user: target });
});

router.post('/friends/:id/accept', (req, res) => {
  const id = Number(req.params.id);
  const friendship = db.prepare('SELECT * FROM friendships WHERE id = ?').get(id);
  if (!friendship) return res.status(404).json({ error: 'Friend request not found' });
  if (friendship.addressee_id !== req.userId) return res.status(403).json({ error: 'Only the addressee can accept this request' });
  db.prepare("UPDATE friendships SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.delete('/friends/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?)').run(id, req.userId, req.userId);
  if (!result.changes) return res.status(404).json({ error: 'Friendship not found' });
  res.json({ ok: true });
});

router.get('/groups', (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.description, g.owner_id, g.agent_name, g.created_at, gm.role,
      owner.username AS owner_username,
      (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count,
      (SELECT COUNT(*) FROM group_links WHERE group_id = g.id) AS material_count,
      (SELECT MAX(created_at) FROM group_messages WHERE group_id = g.id) AS last_message_at
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    JOIN users owner ON owner.id = g.owner_id
    WHERE gm.user_id = ?
    ORDER BY COALESCE(last_message_at, g.created_at) DESC
  `).all(req.userId);
  res.json(groups.map(group => ({
    ...group,
    owner: { id: group.owner_id, username: group.owner_username },
  })));
});

router.post('/groups', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const agentName = String(req.body?.agent_name || 'Group Agent').trim() || 'Group Agent';
  const memberIds = Array.isArray(req.body?.member_ids) ? req.body.member_ids.map(Number).filter(Boolean) : [];
  if (!name) return res.status(400).json({ error: 'Group name is required' });

  for (const memberId of memberIds) {
    if (memberId !== req.userId && !areFriends(req.userId, memberId)) {
      return res.status(400).json({ error: 'Only accepted friends can be invited to a group' });
    }
  }

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO groups (name, description, owner_id, agent_name, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(name, description, req.userId, agentName);
    const groupId = Number(info.lastInsertRowid);
    const insertMember = db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)');
    insertMember.run(groupId, req.userId, 'owner');
    for (const memberId of new Set(memberIds.filter(id => id !== req.userId))) {
      insertMember.run(groupId, memberId, 'member');
    }
    return groupId;
  });
  const groupId = tx();
  res.status(201).json({ id: groupId, ok: true });
});

router.get('/groups/:groupId', (req, res) => {
  const groupId = Number(req.params.groupId);
  const member = ensureGroupMember(groupId, req.userId);
  if (!member) return res.status(404).json({ error: 'Group not found or inaccessible' });

  const group = db.prepare(`
    SELECT g.*, owner.username AS owner_username
    FROM groups g
    JOIN users owner ON owner.id = g.owner_id
    WHERE g.id = ?
  `).get(groupId);
  const members = db.prepare(`
    SELECT gm.user_id AS id, u.username, gm.role, gm.joined_at
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY gm.role = 'owner' DESC, u.username ASC
  `).all(groupId);
  res.json({ ...group, owner: { id: group.owner_id, username: group.owner_username }, members });
});

router.post('/groups/:groupId/members', (req, res) => {
  const groupId = Number(req.params.groupId);
  const member = ensureGroupMember(groupId, req.userId);
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) return res.status(403).json({ error: 'Only group owners or admins can invite members' });
  const userId = Number(req.body?.user_id);
  if (!userId) return res.status(400).json({ error: 'User is required' });
  if (!areFriends(req.userId, userId)) return res.status(400).json({ error: 'Only accepted friends can be invited to a group' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(groupId, userId, 'member');
  res.status(201).json({ ok: true });
});

router.get('/groups/:groupId/messages', (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!ensureGroupMember(groupId, req.userId)) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const rows = db.prepare(`
    SELECT m.id, m.group_id, m.user_id, m.body, m.message_type, m.created_at, u.username
    FROM group_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ?
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT 200
  `).all(groupId);
  res.json(rows.map(row => ({ ...row, user: { id: row.user_id, username: row.username } })));
});

router.post('/groups/:groupId/messages', (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!ensureGroupMember(groupId, req.userId)) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message is required' });
  const info = db.prepare('INSERT INTO group_messages (group_id, user_id, body) VALUES (?, ?, ?)').run(groupId, req.userId, body);
  const message = db.prepare(`
    SELECT m.id, m.group_id, m.user_id, m.body, m.message_type, m.created_at, u.username
    FROM group_messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json({ ...message, user: { id: message.user_id, username: message.username } });
});

router.get('/groups/:groupId/materials', (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!ensureGroupMember(groupId, req.userId)) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const rows = db.prepare(`
    SELECT gl.group_id, gl.link_id, gl.shared_by, gl.note, gl.created_at AS shared_at,
      l.type, l.url, l.title, l.summary, l.comment, l.imported_at,
      u.username AS shared_by_username
    FROM group_links gl
    JOIN links l ON l.id = gl.link_id
    JOIN users u ON u.id = gl.shared_by
    WHERE gl.group_id = ?
    ORDER BY gl.created_at DESC
  `).all(groupId);
  res.json(rows.map(row => ({
    ...row,
    shared_by_user: { id: row.shared_by, username: row.shared_by_username },
  })));
});

router.post('/groups/:groupId/materials', (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!ensureGroupMember(groupId, req.userId)) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const linkId = Number(req.body?.link_id);
  const note = String(req.body?.note || '').trim();
  if (!linkId) return res.status(400).json({ error: 'Material is required' });
  const link = db.prepare('SELECT id FROM links WHERE id = ? AND user_id = ?').get(linkId, req.userId);
  if (!link) return res.status(404).json({ error: 'Only your own material can be shared' });
  db.prepare(`
    INSERT INTO group_links (group_id, link_id, shared_by, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(group_id, link_id) DO UPDATE SET note = excluded.note, shared_by = excluded.shared_by, created_at = datetime('now')
  `).run(groupId, linkId, req.userId, note);
  res.status(201).json({ ok: true });
});

export function requireGroupMember(groupId, userId) {
  return ensureGroupMember(groupId, userId);
}

export default router;
