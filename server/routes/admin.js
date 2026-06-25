import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { emptyAdminTypeStats, presentAdminRecentItem, summarizeAdminItemRows } from '../utils/adminUserStats.js';
import { httpError, jsonError } from '../utils/appError.js';

const router = Router();

function requireAdmin(req, res, next) {
  if (req.userId !== 1) return jsonError(res, httpError(403, '仅管理员可操作'), '管理员校验失败');
  next();
}

router.use(authMiddleware, requireAdmin);

router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT
      u.id,
      u.username,
      u.created_at,
      COALESCE(ts.tag_count, 0) AS tag_count,
      MAX(l.imported_at) AS last_used_at
    FROM users u
    LEFT JOIN links l ON l.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS tag_count
      FROM tags
      GROUP BY user_id
    ) ts ON ts.user_id = u.id
    GROUP BY u.id, u.username, u.created_at, ts.tag_count
    ORDER BY u.id ASC
  `).all();

  const itemRows = db.prepare(`
    SELECT user_id, type, url, status, imported_at
    FROM links
  `).all();
  const rowsByUser = new Map();
  for (const row of itemRows) {
    if (!rowsByUser.has(row.user_id)) rowsByUser.set(row.user_id, []);
    rowsByUser.get(row.user_id).push(row);
  }

  res.json(users.map((user) => {
    const stats = summarizeAdminItemRows(rowsByUser.get(user.id) || []);
    return {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      item_count: stats.item_count,
      tag_count: user.tag_count || 0,
      processing_count: stats.processing_count,
      error_count: stats.error_count,
      last_used_at: stats.last_used_at || null,
      by_type: stats.by_type,
    };
  }));
});

router.get('/users/:id', (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return jsonError(res, httpError(400, '用户 ID 无效'), '读取用户失败');
  }

  const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId);
  if (!user) return jsonError(res, httpError(404, '用户不存在'), '读取用户失败');

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS item_count,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
      MAX(imported_at) AS last_used_at
    FROM links
    WHERE user_id = ?
  `).get(userId);

  const itemRows = db.prepare(`
    SELECT type, url, status, imported_at
    FROM links
    WHERE user_id = ?
  `).all(userId);
  const itemStats = summarizeAdminItemRows(itemRows);

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
      by_type: itemStats.by_type,
      by_status: byStatus,
    },
    recent_items: recentItems.map(presentAdminRecentItem),
  });
});

export default router;
