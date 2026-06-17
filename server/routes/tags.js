import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { httpError, jsonError } from '../utils/appError.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const tags = db.prepare(`
    SELECT t.*, COUNT(lt.link_id) as link_count
    FROM tags t LEFT JOIN link_tags lt ON t.id = lt.tag_id
    WHERE t.user_id = ?
    GROUP BY t.id ORDER BY t.name
  `).all(req.userId);
  res.json(tags);
});

router.post('/', (req, res) => {
  const { name, color } = req.body;
  if (!name) return jsonError(res, httpError(400, '标签名不能为空'), '创建标签失败');
  try {
    const result = db.prepare('INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)')
      .run(req.userId, name.trim(), color || '#6366f1');
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
    res.json(tag);
  } catch {
    jsonError(res, httpError(409, '标签已存在'), '创建标签失败');
  }
});

router.put('/:id', (req, res) => {
  const { name, color } = req.body;
  const tag = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!tag) return jsonError(res, httpError(404, '标签不存在'), '更新标签失败');
  try {
    db.prepare('UPDATE tags SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?')
      .run(name || null, color || null, req.params.id);
    res.json(db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id));
  } catch {
    jsonError(res, httpError(409, '标签已存在'), '更新标签失败');
  }
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return jsonError(res, httpError(404, '标签不存在'), '删除标签失败');
  res.json({ ok: true });
});

export default router;
