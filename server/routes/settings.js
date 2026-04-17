import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Only admin (user id=1) can manage settings
function requireAdmin(req, res, next) {
  if (req.userId !== 1) return res.status(403).json({ error: '仅管理员可操作' });
  next();
}

// GET /api/settings - return all settings (admin only)
router.get('/', authMiddleware, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json(settings);
});

// PUT /api/settings - update one or more settings
router.put('/', authMiddleware, requireAdmin, (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: '参数格式错误' });
  }
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run(key, String(value ?? ''));
    }
  });
  tx(Object.entries(updates));
  res.json({ ok: true });
});

export default router;
