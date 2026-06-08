import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAIConfig, updateAIConfig, testAIConfig } from '../utils/aiConfig.js';
import { getRuntimeQueue } from '../utils/runtimeQueue.js';

const router = Router();

// Only admin (user id=1) can manage settings
function requireAdmin(req, res, next) {
  if (req.userId !== 1) return res.status(403).json({ error: '仅管理员可操作' });
  next();
}

function isReservedSettingKey(key) {
  return String(key).startsWith('ai:');
}

// GET /api/settings/ai - return AI config without secrets
router.get('/ai', authMiddleware, requireAdmin, (req, res) => {
  res.json(getAIConfig());
});

// PUT /api/settings/ai - update AI config
router.put('/ai', authMiddleware, requireAdmin, (req, res) => {
  try {
    const config = updateAIConfig(req.body || {});
    res.json({ ok: true, config });
  } catch (e) {
    res.status(400).json({ error: e.message || 'AI 配置无效' });
  }
});

// POST /api/settings/ai/test - verify AI endpoint/model connectivity
router.post('/ai/test', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await testAIConfig(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'AI 接口测试失败' });
  }
});

// GET /api/settings - return all settings (admin only)
router.get('/', authMiddleware, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings WHERE key NOT LIKE ?').all('ai:%');
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json(settings);
});

// GET /api/settings/system - lightweight operational status
router.get('/system', authMiddleware, requireAdmin, (req, res) => {
  res.json({
    queue: getRuntimeQueue().stats(),
    env: {
      backgroundQueueConcurrency: process.env.BACKGROUND_QUEUE_CONCURRENCY || '1',
      localLlmUrl: process.env.LOCAL_LLM_URL || '',
      assistantMaxSources: process.env.ASSISTANT_MAX_SOURCES || '',
      assistantMaxContextChars: process.env.ASSISTANT_MAX_CONTEXT_CHARS || '',
      assistantMaxTokens: process.env.ASSISTANT_MAX_TOKENS || '',
    },
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// POST /api/settings/system/retry-failed-jobs - retry failed background jobs
router.post('/system/retry-failed-jobs', authMiddleware, requireAdmin, (req, res) => {
  const failedLinkIds = db.prepare(`
    SELECT DISTINCT link_id
    FROM jobs
    WHERE status = 'failed' AND link_id IS NOT NULL
  `).all().map(row => row.link_id);
  const retried = getRuntimeQueue().retryFailedJobs();
  if (retried && failedLinkIds.length) {
    const placeholders = failedLinkIds.map(() => '?').join(',');
    db.prepare(`UPDATE links SET status = 'processing' WHERE id IN (${placeholders})`).run(...failedLinkIds);
  }
  getRuntimeQueue().drain();
  res.json({
    ok: true,
    retried,
    queue: getRuntimeQueue().stats(),
  });
});

// PUT /api/settings - update one or more settings
router.put('/', authMiddleware, requireAdmin, (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: '参数格式错误' });
  }
  if (Object.keys(updates).some(isReservedSettingKey)) {
    return res.status(400).json({ error: 'AI 配置请使用专用接口 /api/settings/ai' });
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
