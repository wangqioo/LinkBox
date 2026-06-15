import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { extractPageMarkdown } from '../utils/extractContent.js';
import { indexLinkContent, removeLinkContentIndex } from '../utils/chunkIndex.js';
import { attachProcessingStatus } from '../utils/itemProcessingStatus.js';
import { createAudioItem, createTextItem } from '../utils/linkCreateService.js';
import { summarizeLinkItem } from '../utils/linkAiActions.js';
import { getRuntimeQueue } from '../utils/runtimeQueue.js';
import { toMobileFile } from '../utils/mobileFilePresenter.js';
import { normalizeUploadedAsset } from '../utils/uploadedAsset.js';
import {
  acceptFileItem,
  acceptImageItem,
  acceptLinkItem,
  retryItemProcessing,
  scheduleItemProcessing,
} from '../utils/itemIntake.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(__dirname, '../uploads');

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `${randomBytes(8).toString('hex')}${extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

const router = Router();
function mobileAuth(req, res, next) {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  return authMiddleware(req, res, next);
}

router.use(mobileAuth);

function getLinkForUser(id, userId) {
  return db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(id, userId);
}

function attachMobileProcessing(linkOrLinks) {
  return attachProcessingStatus(db, linkOrLinks);
}

function rowsToMobileFiles(rows) {
  return attachMobileProcessing(rows).map(toMobileFile);
}

function getMobileFileForUser(id, userId) {
  const link = getLinkForUser(id, userId);
  return link ? toMobileFile(attachMobileProcessing(link)) : null;
}

function uploadedDiskPath(link) {
  if (!link?.image_path) return '';
  return join(UPLOADS_DIR, link.image_path.split('/').pop());
}

function refreshLinkIndex(linkId) {
  removeLinkContentIndex(linkId);
  return indexLinkContent(linkId);
}

router.post('/upload', upload.single('file'), async (req, res) => {
  const importedAt = new Date().toISOString();
  const analyzeNow = req.body?.analyze_now === 'true';
  const queue = getRuntimeQueue();

  if (req.file) {
    const asset = normalizeUploadedAsset(req.file, { uploadsDir: UPLOADS_DIR });
    const type = asset.uploadType;

    if (type === 'image') {
      const batchId = String(req.body?.batch_id || '').trim().slice(0, 80);
      const batchIndex = Number(req.body?.batch_index || 0);
      const { link } = acceptImageItem(db, queue, {
        userId: req.userId,
        imagePath: asset.publicPath,
        diskPath: asset.diskPath,
        originalName: asset.originalName,
        importedAt,
        batchId,
        batchIndex: Number.isFinite(batchIndex) ? batchIndex : 0,
        drain: analyzeNow,
      });
      return res.json(getMobileFileForUser(link.id, req.userId));
    }

    if (type === 'audio') {
      const { link } = createAudioItem(db, {
        userId: req.userId,
        audioPath: asset.publicPath,
        title: asset.originalName,
        importedAt,
      });
      return res.json(getMobileFileForUser(link.id, req.userId));
    }

    const { link } = acceptFileItem(db, queue, {
      userId: req.userId,
      filePath: asset.publicPath,
      diskPath: asset.diskPath,
      originalName: asset.originalName,
      sizeBytes: asset.sizeBytes,
      importedAt,
      drain: analyzeNow,
    });
    return res.json(getMobileFileForUser(link.id, req.userId));
  }

  const url = String(req.body?.url || '').trim();
  if (url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ error: 'Please enter a valid URL' });
    }
    const { link } = acceptLinkItem(db, queue, {
      userId: req.userId,
      url,
      importedAt,
      drain: analyzeNow,
    });
    return res.json(getMobileFileForUser(link.id, req.userId));
  }

  const text = String(req.body?.text || '').trim();
  if (text) {
    const title = text.split(/\r?\n/)[0].slice(0, 80) || 'Text note';
    const { link } = createTextItem(db, {
      userId: req.userId,
      title,
      content: text,
      importedAt,
      indexLink: refreshLinkIndex,
    });
    return res.json(getMobileFileForUser(link.id, req.userId));
  }

  return res.status(400).json({ error: 'Please upload a file or provide a URL/text' });
});

router.get('/', (req, res) => {
  const { date, type, limit = 500, offset = 0 } = req.query;
  const params = [req.userId];
  const conditions = ['user_id = ?'];

  if (date) {
    conditions.push('substr(imported_at, 1, 10) = ?');
    params.push(String(date));
  }
  if (type) {
    const mapped = type === 'document' ? 'file' : String(type);
    conditions.push('type = ?');
    params.push(mapped);
  }

  params.push(Number(limit), Number(offset));
  const rows = db.prepare(`
    SELECT * FROM links
    WHERE ${conditions.join(' AND ')}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...params);

  res.json(rowsToMobileFiles(rows));
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query cannot be empty' });

  const params = [req.userId];
  const conditions = ['user_id = ?'];
  if (req.query.date) {
    conditions.push('substr(imported_at, 1, 10) = ?');
    params.push(String(req.query.date));
  }
  if (req.query.type) {
    conditions.push('type = ?');
    params.push(req.query.type === 'document' ? 'file' : String(req.query.type));
  }
  const like = `%${q}%`;
  conditions.push('(title LIKE ? OR url LIKE ? OR description LIKE ? OR content LIKE ? OR content_md LIKE ? OR summary LIKE ?)');
  params.push(like, like, like, like, like, like);

  const rows = db.prepare(`
    SELECT * FROM links
    WHERE ${conditions.join(' AND ')}
    ORDER BY id DESC
    LIMIT 50
  `).all(...params);

  res.json({
    query: q,
    results: rowsToMobileFiles(rows).map(row => ({
      ...row,
      match_score: 1,
      match_reason: 'Matched LinkBox content',
    })),
  });
});

router.get('/by-date/:date', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM links
    WHERE user_id = ? AND substr(imported_at, 1, 10) = ?
    ORDER BY id DESC
  `).all(req.userId, req.params.date);
  res.json(rowsToMobileFiles(rows));
});

router.get('/stats', (req, res) => {
  const rows = rowsToMobileFiles(
    db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY imported_at DESC').all(req.userId),
  );
  const byType = {};
  const byStatus = {};
  for (const row of rows) {
    byType[row.type] = (byType[row.type] || 0) + 1;
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }
  res.json({
    total: rows.length,
    by_type: byType,
    by_status: byStatus,
    recent_date: rows[0]?.created_at?.slice(0, 10) || null,
  });
});

router.get('/favicon', (req, res) => {
  try {
    const u = new URL(String(req.query.url || ''));
    return res.redirect(302, `${u.protocol}//${u.host}/favicon.ico`);
  } catch {
    return res.status(400).end();
  }
});

router.get('/:id/download', (req, res) => {
  const link = getLinkForUser(req.params.id, req.userId);
  if (!link || !link.image_path) return res.status(404).json({ error: 'File not found' });
  const filename = link.image_path.split('/').pop();
  return res.download(join(UPLOADS_DIR, filename), link.title || filename);
});

router.get('/:id/extract', async (req, res) => {
  const link = getLinkForUser(req.params.id, req.userId);
  if (!link) return res.status(404).json({ error: 'Not found' });
  if (link.type !== 'link' || !link.url) return res.status(400).json({ error: 'Only link items can be extracted' });
  try {
    const result = await extractPageMarkdown(link.url);
    db.prepare('UPDATE links SET content_md = ? WHERE id = ?').run(result.markdown || '', link.id);
    refreshLinkIndex(link.id);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Extract failed' });
  }
});

router.get('/:id', (req, res) => {
  const file = getMobileFileForUser(req.params.id, req.userId);
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.json(file);
});

router.put('/:id/comment', (req, res) => {
  const comment = String(req.body?.comment || '').slice(0, 2000);
  const result = db.prepare('UPDATE links SET comment = ? WHERE id = ? AND user_id = ?')
    .run(comment, req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json(getMobileFileForUser(req.params.id, req.userId));
});

router.delete('/:id', (req, res) => {
  removeLinkContentIndex(req.params.id);
  const result = db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

router.post('/:id/analyze', async (req, res) => {
  const link = getLinkForUser(req.params.id, req.userId);
  if (!link) return res.status(404).json({ error: 'Not found' });

  const current = getMobileFileForUser(link.id, req.userId);
  const activeJob = current?.processing?.activeJob;
  const queue = getRuntimeQueue();

  if (activeJob && ['queued', 'running'].includes(activeJob.status)) {
    return res.json(current);
  }

  if (current?.processing?.state === 'failed') {
    try {
      retryItemProcessing(db, queue, { linkId: link.id, userId: req.userId });
      return res.json(getMobileFileForUser(link.id, req.userId));
    } catch (err) {
      if (err.status !== 409) {
        return res.status(err.status || 500).json({ error: err.status ? err.message : err.message || 'Analyze failed' });
      }
    }
  }

  if (link.type === 'link' && link.url) {
    scheduleItemProcessing(db, queue, {
      linkId: link.id,
      userId: req.userId,
      drain: true,
    });
    return res.json(getMobileFileForUser(link.id, req.userId));
  }

  if (link.type === 'image' && link.image_path) {
    scheduleItemProcessing(db, queue, {
      linkId: link.id,
      userId: req.userId,
      diskPath: uploadedDiskPath(link),
      drain: true,
    });
    return res.json(getMobileFileForUser(link.id, req.userId));
  }

  if (link.type === 'file' && link.image_path) {
    scheduleItemProcessing(db, queue, {
      linkId: link.id,
      userId: req.userId,
      diskPath: uploadedDiskPath(link),
      drain: true,
    });
    return res.json(getMobileFileForUser(link.id, req.userId));
  }

  try {
    await summarizeLinkItem(db, { linkId: link.id, userId: req.userId });
    return res.json(getMobileFileForUser(link.id, req.userId));
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.status ? e.message : e.message || 'Analyze failed' });
  }
});

export default router;
