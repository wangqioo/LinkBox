import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { extname, join } from 'path';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { normalizeUploadedAsset } from '../utils/uploadedAsset.js';
import { getRuntimeQueue } from '../utils/runtimeQueue.js';
import { getAutoProcessLinkUrl } from '../utils/linkAutoProcess.js';
import { acceptFileItem, acceptImageItem, acceptLinkItem } from '../utils/itemIntake.js';
import { createAudioItem, createTextItem } from '../utils/linkCreateService.js';
import { indexLinkContent, removeLinkContentIndex } from '../utils/chunkIndex.js';
import { indexDocumentForItem } from '../utils/documentIndex.js';
import { toMobileFile } from '../utils/mobileFilePresenter.js';
import { attachProcessingStatus } from '../utils/itemProcessingStatus.js';
import {
  areFriends,
  currentIsoTime,
  directMessagePayload,
  ensureGroupMember,
  groupMessagePayload,
  materialPayload as shapeMaterialPayload,
  requireAcceptedFriend,
  toUtcIsoTime,
} from '../utils/socialService.js';

const UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${randomBytes(8).toString('hex')}${extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

export function createSocialRouter(database = db) {
const router = Router();
router.use(authMiddleware);

function attachMobileLink(linkId) {
  const row = database.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
  return row ? toMobileFile(attachProcessingStatus(database, row)) : null;
}

function refreshItemAiIndexes(linkId) {
  indexLinkContent(linkId);
  indexDocumentForItem(database, linkId);
}

function materialPayload(link) {
  return shapeMaterialPayload(link, { file: attachMobileLink(link.id) });
}

function createScopedChatItem(req, { scope = 'chat' } = {}) {
  const importedAt = currentIsoTime();
  const queue = getRuntimeQueue();
  if (req.file) {
    const asset = normalizeUploadedAsset(req.file, { uploadsDir: UPLOADS_DIR });
    if (asset.uploadType === 'image') {
      const batchId = String(req.body?.batch_id || '').trim().slice(0, 80);
      const batchIndex = Number(req.body?.batch_index || 0);
      const { link } = acceptImageItem(database, queue, {
        userId: req.userId,
        imagePath: asset.publicPath,
        diskPath: asset.diskPath,
        originalName: asset.originalName,
        importedAt,
        batchId,
        batchIndex: Number.isFinite(batchIndex) ? batchIndex : 0,
        scope,
      });
      return link;
    }
    if (asset.uploadType === 'audio') {
      const { link } = createAudioItem(database, {
        userId: req.userId,
        audioPath: asset.publicPath,
        title: asset.originalName,
        importedAt,
        scope,
      });
      return link;
    }
    const { link } = acceptFileItem(database, queue, {
      userId: req.userId,
      filePath: asset.publicPath,
      diskPath: asset.diskPath,
      originalName: asset.originalName,
      sizeBytes: asset.sizeBytes,
      importedAt,
      scope,
    });
    return link;
  }
  const url = String(req.body?.url || '').trim();
  if (url) {
    const autoUrl = getAutoProcessLinkUrl(url) || url;
    if (!autoUrl.startsWith('http://') && !autoUrl.startsWith('https://')) {
      const { link } = createTextItem(database, {
        userId: req.userId,
        title: url.slice(0, 80),
        content: url,
        importedAt,
        indexLink: indexLinkContent,
        scope,
      });
      return link;
    }
    const { link } = acceptLinkItem(database, queue, {
      userId: req.userId,
      url: autoUrl,
      importedAt,
      scope,
    });
    return link;
  }
  const text = String(req.body?.text || '').trim();
  if (text) {
    const { link } = createTextItem(database, {
      userId: req.userId,
      title: text.split(/\r?\n/)[0].slice(0, 80) || '文字消息',
      content: text,
      importedAt,
      indexLink: indexLinkContent,
      scope,
    });
    return link;
  }
  return null;
}

router.get('/users/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const rows = database.prepare(`
    SELECT id, username
    FROM users
    WHERE id != ? AND username LIKE ?
    ORDER BY username ASC
    LIMIT 12
  `).all(req.userId, `%${q}%`);
  res.json(rows);
});

router.get('/friends', (req, res) => {
  const rows = database.prepare(`
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
    ? database.prepare('SELECT id, username FROM users WHERE id = ?').get(addresseeId)
    : database.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.userId) return res.status(400).json({ error: 'Cannot add yourself as a friend' });

  const existing = database.prepare(`
    SELECT * FROM friendships
    WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
  `).get(req.userId, target.id, target.id, req.userId);

  if (existing?.status === 'accepted') return res.json({ ok: true, status: 'accepted', user: target });
  if (existing?.status === 'pending' && existing.addressee_id === req.userId) {
    database.prepare("UPDATE friendships SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(existing.id);
    return res.json({ ok: true, status: 'accepted', user: target });
  }
  if (existing?.status === 'pending') return res.json({ ok: true, status: 'pending', user: target });

  database.prepare(`
    INSERT INTO friendships (requester_id, addressee_id, status, updated_at)
    VALUES (?, ?, 'pending', datetime('now'))
  `).run(req.userId, target.id);
  res.status(201).json({ ok: true, status: 'pending', user: target });
});

router.post('/friends/:id/accept', (req, res) => {
  const id = Number(req.params.id);
  const friendship = database.prepare('SELECT * FROM friendships WHERE id = ?').get(id);
  if (!friendship) return res.status(404).json({ error: 'Friend request not found' });
  if (friendship.addressee_id !== req.userId) return res.status(403).json({ error: 'Only the addressee can accept this request' });
  database.prepare("UPDATE friendships SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.delete('/friends/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = database.prepare('DELETE FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?)').run(id, req.userId, req.userId);
  if (!result.changes) return res.status(404).json({ error: 'Friendship not found' });
  res.json({ ok: true });
});

router.get('/friends/:userId/messages', (req, res) => {
  const friendId = Number(req.params.userId);
  const friend = requireAcceptedFriend(database, req.userId, friendId);
  if (!friend) return res.status(403).json({ error: 'Only accepted friends can exchange messages' });
  const currentUser = database.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId);
  const rows = database.prepare(`
    SELECT m.id, m.sender_id AS user_id, m.recipient_id, m.body, m.message_type, m.created_at, u.username,
      l.id AS link_id, l.title AS link_title, l.url AS link_url, l.summary AS link_summary, l.type AS link_type
    FROM direct_messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN links l ON l.id = CAST(m.body AS INTEGER) AND m.message_type = 'material'
    WHERE (m.sender_id = ? AND m.recipient_id = ?)
       OR (m.sender_id = ? AND m.recipient_id = ?)
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT 200
  `).all(req.userId, friendId, friendId, req.userId);
  res.json({
    current_user: currentUser,
    friend,
    messages: rows.map(row => ({
      ...directMessagePayload({
        id: row.id,
        user_id: row.user_id,
        recipient_id: row.recipient_id,
        body: row.body,
        message_type: row.message_type,
        created_at: row.created_at,
        username: row.username,
      }),
      ...(row.message_type === 'material' && row.link_id ? {
        material: materialPayload({
          id: row.link_id,
          title: row.link_title,
          url: row.link_url,
          summary: row.link_summary,
          type: row.link_type,
        }),
      } : {}),
    })),
  });
});

router.post('/friends/:userId/messages', (req, res) => {
  const friendId = Number(req.params.userId);
  const friend = requireAcceptedFriend(database, req.userId, friendId);
  if (!friend) return res.status(403).json({ error: 'Only accepted friends can exchange messages' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message is required' });
  const createdAt = currentIsoTime();
  const info = database.prepare(`
    INSERT INTO direct_messages (sender_id, recipient_id, body, created_at)
    VALUES (?, ?, ?, ?)
  `).run(req.userId, friendId, body, createdAt);
  const message = database.prepare(`
    SELECT m.id, m.sender_id AS user_id, m.recipient_id, m.body, m.message_type, m.created_at, u.username
    FROM direct_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json(directMessagePayload(message));
});

router.post('/friends/:userId/materials', (req, res) => {
  const friendId = Number(req.params.userId);
  const friend = requireAcceptedFriend(database, req.userId, friendId);
  if (!friend) return res.status(403).json({ error: 'Only accepted friends can exchange messages' });
  const linkId = Number(req.body?.link_id);
  if (!linkId) return res.status(400).json({ error: 'Material is required' });
  const link = database.prepare(`
    SELECT id, title, url, summary, type
    FROM links
    WHERE id = ? AND user_id = ?
  `).get(linkId, req.userId);
  if (!link) return res.status(404).json({ error: 'Only your own material can be shared' });
  const createdAt = currentIsoTime();
  const info = database.prepare(`
    INSERT INTO direct_messages (sender_id, recipient_id, body, message_type, created_at)
    VALUES (?, ?, ?, 'material', ?)
  `).run(req.userId, friendId, String(linkId), createdAt);
  const message = database.prepare(`
    SELECT m.id, m.sender_id AS user_id, m.recipient_id, m.body, m.message_type, m.created_at, u.username
    FROM direct_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json({
    ...directMessagePayload(message),
    material: materialPayload(link),
  });
});

router.post('/friends/:userId/uploads', upload.single('file'), (req, res) => {
  const friendId = Number(req.params.userId);
  const friend = requireAcceptedFriend(database, req.userId, friendId);
  if (!friend) return res.status(403).json({ error: 'Only accepted friends can exchange messages' });
  const link = createScopedChatItem(req, { scope: 'chat' });
  if (!link) return res.status(400).json({ error: 'Please upload a file or provide text/url' });
  const createdAt = currentIsoTime();
  const info = database.prepare(`
    INSERT INTO direct_messages (sender_id, recipient_id, body, message_type, created_at)
    VALUES (?, ?, ?, 'material', ?)
  `).run(req.userId, friendId, String(link.id), createdAt);
  const message = database.prepare(`
    SELECT m.id, m.sender_id AS user_id, m.recipient_id, m.body, m.message_type, m.created_at, u.username
    FROM direct_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json({
    ...directMessagePayload(message),
    material: materialPayload(link),
  });
});

router.put('/friends/:userId/materials/:linkId/comment', (req, res) => {
  const friendId = Number(req.params.userId);
  const friend = requireAcceptedFriend(database, req.userId, friendId);
  if (!friend) return res.status(403).json({ error: 'Only accepted friends can exchange messages' });
  const linkId = Number(req.params.linkId);
  const ownsChatMaterial = database.prepare(`
    SELECT 1
    FROM direct_messages
    WHERE message_type = 'material' AND body = ?
      AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
  `).get(String(linkId), req.userId, friendId, friendId, req.userId);
  if (!ownsChatMaterial) return res.status(404).json({ error: 'Material not found in this chat' });
  const comment = String(req.body?.comment || '').slice(0, 2000);
  database.prepare('UPDATE links SET comment = ? WHERE id = ?').run(comment, linkId);
  refreshItemAiIndexes(linkId);
  const link = database.prepare('SELECT id, title, url, summary, description, type FROM links WHERE id = ?').get(linkId);
  res.json({ ok: true, material: materialPayload(link) });
});

router.delete('/friends/:userId/messages/:messageId', (req, res) => {
  const friendId = Number(req.params.userId);
  const friend = requireAcceptedFriend(database, req.userId, friendId);
  if (!friend) return res.status(403).json({ error: 'Only accepted friends can exchange messages' });
  const messageId = Number(req.params.messageId);
  const result = database.prepare(`
    DELETE FROM direct_messages
    WHERE id = ? AND sender_id = ? AND recipient_id = ?
  `).run(messageId, req.userId, friendId);
  if (!result.changes) return res.status(404).json({ error: 'Message not found or cannot be deleted' });
  res.json({ ok: true });
});

router.get('/groups', (req, res) => {
  const groups = database.prepare(`
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
    if (memberId !== req.userId && !areFriends(database, req.userId, memberId)) {
      return res.status(400).json({ error: 'Only accepted friends can be invited to a group' });
    }
  }

  const tx = database.transaction(() => {
    const info = database.prepare(`
      INSERT INTO groups (name, description, owner_id, agent_name, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(name, description, req.userId, agentName);
    const groupId = Number(info.lastInsertRowid);
    const insertMember = database.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)');
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
  const member = ensureGroupMember(database, groupId, req.userId);
  if (!member) return res.status(404).json({ error: 'Group not found or inaccessible' });

  const group = database.prepare(`
    SELECT g.*, owner.username AS owner_username
    FROM groups g
    JOIN users owner ON owner.id = g.owner_id
    WHERE g.id = ?
  `).get(groupId);
  const members = database.prepare(`
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
  const member = ensureGroupMember(database, groupId, req.userId);
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) return res.status(403).json({ error: 'Only group owners or admins can invite members' });
  const userId = Number(req.body?.user_id);
  if (!userId) return res.status(400).json({ error: 'User is required' });
  if (!areFriends(database, req.userId, userId)) return res.status(400).json({ error: 'Only accepted friends can be invited to a group' });
  database.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(groupId, userId, 'member');
  res.status(201).json({ ok: true });
});

router.get('/groups/:groupId/messages', (req, res) => {
  const groupId = Number(req.params.groupId);
  const member = ensureGroupMember(database, groupId, req.userId);
  if (!member) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const currentUser = database.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId);
  const rows = database.prepare(`
    SELECT m.id, m.group_id, m.user_id, m.body, m.message_type, m.created_at, u.username
    FROM group_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ?
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT 200
  `).all(groupId);
  const materials = database.prepare(`
    SELECT gl.group_id, gl.link_id, gl.shared_by AS user_id, gl.note, gl.created_at,
      l.title, l.url, l.summary, l.description, l.type,
      u.username
    FROM group_links gl
    JOIN links l ON l.id = gl.link_id
    JOIN users u ON u.id = gl.shared_by
    WHERE gl.group_id = ?
  `).all(groupId);
  const messages = [
    ...rows.map(row => groupMessagePayload(row)),
    ...materials.map(row => ({
      id: `material:${row.link_id}`,
      group_id: row.group_id,
      user_id: row.user_id,
      body: row.note || row.title || row.url || `资料 ${row.link_id}`,
      message_type: 'material',
      created_at: toUtcIsoTime(row.created_at),
      user: { id: row.user_id, username: row.username },
      material: {
        ...materialPayload({
          id: row.link_id,
          title: row.title,
          url: row.url,
          summary: row.note || row.summary,
          description: row.description,
          type: row.type,
        }),
        note: row.note || '',
      },
    })),
  ].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
  res.json({
    current_user: currentUser,
    current_member: member,
    messages,
  });
});

router.post('/groups/:groupId/messages', (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!ensureGroupMember(database, groupId, req.userId)) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message is required' });
  const createdAt = currentIsoTime();
  const info = database.prepare('INSERT INTO group_messages (group_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(groupId, req.userId, body, createdAt);
  const message = database.prepare(`
    SELECT m.id, m.group_id, m.user_id, m.body, m.message_type, m.created_at, u.username
    FROM group_messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json(groupMessagePayload(message));
});

router.get('/groups/:groupId/materials', (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!ensureGroupMember(database, groupId, req.userId)) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const rows = database.prepare(`
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
    shared_at: toUtcIsoTime(row.shared_at),
    shared_by_user: { id: row.shared_by, username: row.shared_by_username },
  })));
});

router.post('/groups/:groupId/materials', (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!ensureGroupMember(database, groupId, req.userId)) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const linkId = Number(req.body?.link_id);
  const note = String(req.body?.note || '').trim();
  if (!linkId) return res.status(400).json({ error: 'Material is required' });
  const link = database.prepare('SELECT id FROM links WHERE id = ? AND user_id = ?').get(linkId, req.userId);
  if (!link) return res.status(404).json({ error: 'Only your own material can be shared' });
  const createdAt = currentIsoTime();
  database.prepare(`
    INSERT INTO group_links (group_id, link_id, shared_by, note, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(group_id, link_id) DO UPDATE SET note = excluded.note, shared_by = excluded.shared_by, created_at = excluded.created_at
  `).run(groupId, linkId, req.userId, note, createdAt);
  res.status(201).json({ ok: true });
});

router.post('/groups/:groupId/uploads', upload.single('file'), (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!ensureGroupMember(database, groupId, req.userId)) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const note = String(req.body?.note || '').trim();
  const link = createScopedChatItem(req, { scope: 'chat' });
  if (!link) return res.status(400).json({ error: 'Please upload a file or provide text/url' });
  const createdAt = currentIsoTime();
  database.prepare(`
    INSERT INTO group_links (group_id, link_id, shared_by, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(groupId, link.id, req.userId, note, createdAt);
  res.status(201).json({
    id: `material:${link.id}`,
    group_id: groupId,
    user_id: req.userId,
    body: note || link.title || link.url || `资料 ${link.id}`,
    message_type: 'material',
    created_at: createdAt,
    user: database.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId),
    material: materialPayload(link),
  });
});

router.put('/groups/:groupId/materials/:linkId/comment', (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!ensureGroupMember(database, groupId, req.userId)) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const linkId = Number(req.params.linkId);
  const exists = database.prepare('SELECT 1 FROM group_links WHERE group_id = ? AND link_id = ?').get(groupId, linkId);
  if (!exists) return res.status(404).json({ error: 'Material not found in this group' });
  const comment = String(req.body?.comment || '').slice(0, 2000);
  database.prepare('UPDATE links SET comment = ? WHERE id = ?').run(comment, linkId);
  refreshItemAiIndexes(linkId);
  const link = database.prepare('SELECT id, title, url, summary, description, type FROM links WHERE id = ?').get(linkId);
  res.json({ ok: true, material: materialPayload(link) });
});

router.delete('/groups/:groupId/messages/:messageId', (req, res) => {
  const groupId = Number(req.params.groupId);
  const member = ensureGroupMember(database, groupId, req.userId);
  if (!member) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const messageId = Number(req.params.messageId);
  const where = member.role === 'owner' || member.role === 'admin'
    ? 'id = ? AND group_id = ?'
    : 'id = ? AND group_id = ? AND user_id = ?';
  const params = member.role === 'owner' || member.role === 'admin'
    ? [messageId, groupId]
    : [messageId, groupId, req.userId];
  const result = database.prepare(`DELETE FROM group_messages WHERE ${where}`).run(...params);
  if (!result.changes) return res.status(404).json({ error: 'Message not found or cannot be deleted' });
  res.json({ ok: true });
});

router.delete('/groups/:groupId/materials/:linkId', (req, res) => {
  const groupId = Number(req.params.groupId);
  const member = ensureGroupMember(database, groupId, req.userId);
  if (!member) return res.status(404).json({ error: 'Group not found or inaccessible' });
  const linkId = Number(req.params.linkId);
  const material = database.prepare('SELECT * FROM group_links WHERE group_id = ? AND link_id = ?').get(groupId, linkId);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  if (material.shared_by !== req.userId && member.role !== 'owner' && member.role !== 'admin') {
    return res.status(403).json({ error: 'Only the sender or group owner can delete this material' });
  }
  database.prepare('DELETE FROM group_links WHERE group_id = ? AND link_id = ?').run(groupId, linkId);
  const link = database.prepare("SELECT id, scope FROM links WHERE id = ?").get(linkId);
  if (link?.scope === 'chat') {
    removeLinkContentIndex(linkId);
    database.prepare('DELETE FROM links WHERE id = ?').run(linkId);
  }
  res.json({ ok: true });
});

return router;
}

export function requireGroupMember(groupId, userId) {
  return db.prepare(`
    SELECT gm.role, g.name, g.owner_id, g.agent_name
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.group_id = ? AND gm.user_id = ?
  `).get(groupId, userId) || null;
}

const router = createSocialRouter();
export default router;
