import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function requireAdmin(req, res, next) {
  if (req.userId !== 1) return res.status(403).json({ error: '仅管理员可操作' });
  next();
}

router.use(authMiddleware, requireAdmin);

function emptyTypeStats() {
  return { link: 0, text: 0, image: 0, audio: 0, file: 0 };
}

router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT
      u.id,
      u.username,
      u.created_at,
      COALESCE(ls.item_count, 0) AS item_count,
      COALESCE(ls.link_count, 0) AS link_count,
      COALESCE(ls.text_count, 0) AS text_count,
      COALESCE(ls.image_count, 0) AS image_count,
      COALESCE(ls.audio_count, 0) AS audio_count,
      COALESCE(ls.file_count, 0) AS file_count,
      COALESCE(ls.processing_count, 0) AS processing_count,
      COALESCE(ls.error_count, 0) AS error_count,
      COALESCE(ts.tag_count, 0) AS tag_count,
      ls.last_used_at
    FROM users u
    LEFT JOIN (
      SELECT
        user_id,
        COUNT(*) AS item_count,
        SUM(CASE WHEN type = 'link' THEN 1 ELSE 0 END) AS link_count,
        SUM(CASE WHEN type = 'text' THEN 1 ELSE 0 END) AS text_count,
        SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END) AS image_count,
        SUM(CASE WHEN type = 'audio' THEN 1 ELSE 0 END) AS audio_count,
        SUM(CASE WHEN type = 'file' THEN 1 ELSE 0 END) AS file_count,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
        MAX(imported_at) AS last_used_at
      FROM links
      GROUP BY user_id
    ) ls ON ls.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS tag_count
      FROM tags
      GROUP BY user_id
    ) ts ON ts.user_id = u.id
    ORDER BY u.id ASC
  `).all();

  res.json(users.map((user) => ({
    id: user.id,
    username: user.username,
    created_at: user.created_at,
    item_count: user.item_count || 0,
    tag_count: user.tag_count || 0,
    processing_count: user.processing_count || 0,
    error_count: user.error_count || 0,
    last_used_at: user.last_used_at || null,
    by_type: {
      link: user.link_count || 0,
      text: user.text_count || 0,
      image: user.image_count || 0,
      audio: user.audio_count || 0,
      file: user.file_count || 0,
    },
  })));
});

router.get('/users/:id', (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: '用户 ID 无效' });
  }

  const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS item_count,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
      MAX(imported_at) AS last_used_at
    FROM links
    WHERE user_id = ?
  `).get(userId);

  const typeRows = db.prepare(`
    SELECT COALESCE(type, 'link') AS type, COUNT(*) AS count
    FROM links
    WHERE user_id = ?
    GROUP BY COALESCE(type, 'link')
  `).all(userId);

  const statusRows = db.prepare(`
    SELECT COALESCE(status, '') AS status, COUNT(*) AS count
    FROM links
    WHERE user_id = ?
    GROUP BY COALESCE(status, '')
  `).all(userId);

  const recentItems = db.prepare(`
    SELECT id, type, url, title, description, comment, imported_at, created_at, status
    FROM links
    WHERE user_id = ?
    ORDER BY imported_at DESC, id DESC
    LIMIT 30
  `).all(userId);

  const byType = emptyTypeStats();
  for (const row of typeRows) byType[row.type || 'link'] = row.count;

  const byStatus = {};
  for (const row of statusRows) byStatus[row.status || 'empty'] = row.count;

  res.json({
    user,
    stats: {
      item_count: totals.item_count || 0,
      processing_count: totals.processing_count || 0,
      error_count: totals.error_count || 0,
      last_used_at: totals.last_used_at || null,
      tag_count: db.prepare('SELECT COUNT(*) AS count FROM tags WHERE user_id = ?').get(userId).count || 0,
      by_type: byType,
      by_status: byStatus,
    },
    recent_items: recentItems,
  });
});

export default router;
