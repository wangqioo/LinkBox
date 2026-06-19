import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAIConfig, updateAIConfig, testAIConfig } from '../utils/aiConfig.js';
import { getEmbeddingConfig, updateEmbeddingConfig, testEmbeddingConfig } from '../utils/embeddingConfig.js';
import { getRuntimeQueue } from '../utils/runtimeQueue.js';
import { UPLOADS_DIR } from '../utils/uploadMiddleware.js';
import { getSystemHealth } from '../utils/systemHealth.js';
import {
  backfillMissingDocumentEmbeddings,
  getDocumentMaintenanceStats,
  reindexAllDocuments,
} from '../utils/documentMaintenance.js';

// Only admin (user id=1) can manage settings
function requireAdmin(req, res, next) {
  if (req.userId !== 1) return res.status(403).json({ error: '仅管理员可操作' });
  next();
}

function isReservedSettingKey(key) {
  const settingKey = String(key);
  return settingKey.startsWith('ai:') || settingKey.startsWith('embedding:');
}

function listFailedJobs(database, limit = 20) {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return database.prepare(`
    SELECT id, type, link_id, attempts, max_attempts, last_error, updated_at
    FROM jobs
    WHERE status = 'failed'
    ORDER BY datetime(updated_at) DESC, id DESC
    LIMIT ?
  `).all(boundedLimit);
}

function selectedFailedLinkIds(database, ids) {
  if (ids && !ids.length) return [];

  const params = [];
  let idClause = '';
  if (ids) {
    idClause = ` AND id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }

  return database.prepare(`
    SELECT DISTINCT link_id
    FROM jobs
    WHERE status = 'failed' AND link_id IS NOT NULL${idClause}
  `).all(...params).map(row => row.link_id);
}

export function createSettingsRouter({
  database = db,
  getQueue = getRuntimeQueue,
  uploadsDir = UPLOADS_DIR,
} = {}) {
  const router = Router();

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

// GET /api/settings/embeddings - return embedding config without secrets
router.get('/embeddings', authMiddleware, requireAdmin, (req, res) => {
  res.json(getEmbeddingConfig());
});

// PUT /api/settings/embeddings - update embedding config
router.put('/embeddings', authMiddleware, requireAdmin, (req, res) => {
  try {
    const config = updateEmbeddingConfig(req.body || {});
    res.json({ ok: true, config });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Embedding settings are invalid' });
  }
});

// POST /api/settings/embeddings/test - verify embedding provider connectivity
router.post('/embeddings/test', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await testEmbeddingConfig(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Embedding endpoint test failed' });
  }
});

// GET /api/settings - return all settings (admin only)
router.get('/', authMiddleware, requireAdmin, (req, res) => {
  const rows = database.prepare('SELECT key, value FROM settings WHERE key NOT LIKE ? AND key NOT LIKE ?').all('ai:%', 'embedding:%');
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json(settings);
});

// GET /api/settings/system - operational status
router.get('/system', authMiddleware, requireAdmin, async (req, res) => {
  const queue = getQueue();
  const embeddingConfig = getEmbeddingConfig({ includeSecret: true });
  const health = await getSystemHealth({
    db: database,
    queue,
    uploadsDir,
  });
  const queueStats = queue.stats();

  res.json({
    health,
    queue: {
      ...queueStats,
      failedJobs: listFailedJobs(database),
    },
    documents: getDocumentMaintenanceStats(database, {
      provider: embeddingConfig.provider,
      model: embeddingConfig.model,
    }),
    env: {
      backgroundQueueConcurrency: process.env.BACKGROUND_QUEUE_CONCURRENCY || '1',
      localLlmUrl: process.env.LOCAL_LLM_URL || '',
      uploadsDir,
      pdftotextBin: process.env.PDFTOTEXT_BIN || 'pdftotext',
      libreofficeBin: process.env.LIBREOFFICE_BIN || 'libreoffice',
      assistantMaxSources: process.env.ASSISTANT_MAX_SOURCES || '',
      assistantMaxContextChars: process.env.ASSISTANT_MAX_CONTEXT_CHARS || '',
      assistantMaxTokens: process.env.ASSISTANT_MAX_TOKENS || '',
    },
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// POST /api/settings/system/reindex-documents - rebuild canonical documents/chunks
router.post('/system/reindex-documents', authMiddleware, requireAdmin, (req, res) => {
  const result = reindexAllDocuments(database);
  res.json({
    ok: true,
    indexed: result.documents,
    chunks: result.chunks,
    stats: getDocumentMaintenanceStats(database),
  });
});

// POST /api/settings/system/backfill-embeddings - enqueue missing document embeddings
router.post('/system/backfill-embeddings', authMiddleware, requireAdmin, (req, res) => {
  const embeddingConfig = getEmbeddingConfig({ includeSecret: true });
  const queue = getQueue();
  const result = backfillMissingDocumentEmbeddings(database, queue, {
    provider: embeddingConfig.provider,
    model: embeddingConfig.model,
  });
  queue.drain();
  res.json({
    ok: true,
    ...result,
    queue: queue.stats(),
    stats: getDocumentMaintenanceStats(database, {
      provider: embeddingConfig.provider,
      model: embeddingConfig.model,
    }),
  });
});

// POST /api/settings/system/retry-failed-jobs - retry failed background jobs
router.post('/system/retry-failed-jobs', authMiddleware, requireAdmin, (req, res) => {
  const hasIds = Object.prototype.hasOwnProperty.call(req.body || {}, 'ids');
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(id => Number(id)).filter(Number.isInteger)
    : null;
  const queue = getQueue();
  const failedLinkIds = selectedFailedLinkIds(database, hasIds ? ids : null);
  const retried = hasIds && !ids.length
    ? 0
    : queue.retryFailedJobs(hasIds ? { ids } : undefined);
  if (retried && failedLinkIds.length) {
    const placeholders = failedLinkIds.map(() => '?').join(',');
    database.prepare(`UPDATE links SET status = 'processing' WHERE id IN (${placeholders})`).run(...failedLinkIds);
  }
  queue.drain();
  res.json({
    ok: true,
    retried,
    queue: queue.stats(),
  });
});

// PUT /api/settings - update one or more settings
router.put('/', authMiddleware, requireAdmin, (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: '参数格式错误' });
  }
  if (Object.keys(updates).some(isReservedSettingKey)) {
    return res.status(400).json({ error: 'AI 和 Embedding 配置请使用专用接口' });
  }
  const upsert = database.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = database.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run(key, String(value ?? ''));
    }
  });
  tx(Object.entries(updates));
  res.json({ ok: true });
});

  return router;
}

export default createSettingsRouter();
