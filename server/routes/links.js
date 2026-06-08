import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { indexLinkContent } from '../utils/chunkIndex.js';
import { getRuntimeQueue } from '../utils/runtimeQueue.js';
import { enqueueFileProcessing, enqueueImageProcessing, enqueueLinkProcessing } from '../utils/processingJobs.js';
import { decodeUploadName, parseTagIds } from '../utils/linkPayloads.js';
import { buildLinkListQuery } from '../utils/linkListQuery.js';
import {
  attachTags as attachLinkTags,
  createAudioItem,
  createFileItem,
  createImageItem,
  createLinkItem,
  createTextItem,
  importLinkItems,
  setTags as setLinkTags,
} from '../utils/linkCreateService.js';
import {
  extractLinkContent,
  generateLinkLearningNote,
  summarizeLinkItem,
} from '../utils/linkAiActions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(__dirname, '../uploads');
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const id = randomBytes(8).toString('hex');
    cb(null, `${id}${extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('只支持图片文件'));
  },
});

const uploadAudio = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream') cb(null, true);
    else cb(new Error('只支持音频文件'));
  },
});

const uploadFile = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

const router = Router();

// Image proxy - public route (no auth), proxies external images with proper headers
// Placed BEFORE authMiddleware so browser <img> tags can load without JWT token
router.get('/image-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.startsWith('http')) return res.status(400).end();
  const isWeChat = url.includes('qpic.cn') || url.includes('weixin') || url.includes('mmbiz');
  try {
    const referer = isWeChat ? 'https://mp.weixin.qq.com/' : new URL(url).origin + '/';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': isWeChat
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20G75 MicroMessenger/8.0.40'
          : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer,
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      // Fallback: redirect browser to original URL (works for non-restricted images)
      return res.redirect(302, url);
    }
    const ct = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (e) {
    console.error('image-proxy error:', e.message, 'url:', url?.slice(0, 80));
    // Fallback: redirect browser to original URL
    if (!isWeChat) return res.redirect(302, url);
    res.status(502).end();
  }
});

router.use(authMiddleware);

function attachTags(linkId) {
  return attachLinkTags(db, linkId);
}

function setTags(linkId, tagIds) {
  return setLinkTags(db, linkId, tagIds);
}

function parseMultipartTags(req, res) {
  try {
    return parseTagIds(req.body.tag_ids);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return null;
  }
}

// List items with filters
router.get('/', (req, res) => {
  const { sql, countSql, params, countParams, page, limit } = buildLinkListQuery({
    userId: req.userId,
    query: req.query,
  });

  const links = db.prepare(sql).all(...params);
  const { total } = db.prepare(countSql).get(...countParams);
  const tagStmt = db.prepare('SELECT t.* FROM tags t JOIN link_tags lt ON t.id = lt.tag_id WHERE lt.link_id = ?');
  const result = links.map(link => ({ ...link, tags: tagStmt.all(link.id) }));

  res.json({ links: result, total, page, limit });
});

// Get single item
router.get('/:id', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!link) return res.status(404).json({ error: '不存在' });
  res.json({ ...link, tags: attachTags(link.id) });
});

// Add link (saves immediately, fetches metadata in background)
router.post('/', (req, res) => {
  const { url, title, comment, tag_ids, imported_at } = req.body;
  if (!url) return res.status(400).json({ error: 'URL 不能为空' });

  const { link, processing } = createLinkItem(db, {
    userId: req.userId,
    url,
    title,
    comment,
    tagIds: tag_ids,
    importedAt: imported_at || new Date().toISOString(),
  });
  res.json(link);

  enqueueLinkProcessing(getRuntimeQueue(), processing);
});

// Add text note
router.post('/text', (req, res) => {
  const { title, content, comment, tag_ids, imported_at } = req.body;
  if (!content && !title) return res.status(400).json({ error: '标题或内容不能为空' });

  const { link } = createTextItem(db, {
    userId: req.userId,
    title,
    content,
    comment,
    tagIds: tag_ids,
    importedAt: imported_at || new Date().toISOString(),
    indexLink: indexLinkContent,
  });
  res.json(link);
});

// Upload image
router.post('/image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传图片' });

  const imagePath = `/uploads/${req.file.filename}`;
  const diskPath = join(UPLOADS_DIR, req.file.filename);
  const { comment, imported_at, title } = req.body;
  const parsedTags = parseMultipartTags(req, res);
  if (parsedTags === null) return;

  const { link, processing } = createImageItem(db, {
    userId: req.userId,
    imagePath,
    diskPath,
    originalName: decodeUploadName(req.file.originalname),
    title,
    comment,
    tagIds: parsedTags,
    importedAt: imported_at || new Date().toISOString(),
  });
  res.json(link);

  enqueueImageProcessing(getRuntimeQueue(), processing);
});

// Upload audio
router.post('/audio', uploadAudio.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传录音' });

  const audioPath = `/uploads/${req.file.filename}`;
  const { comment, imported_at, title } = req.body;
  const parsedTags = parseMultipartTags(req, res);
  if (parsedTags === null) return;

  const { link } = createAudioItem(db, {
    userId: req.userId,
    audioPath,
    title,
    comment,
    tagIds: parsedTags,
    importedAt: imported_at || new Date().toISOString(),
  });
  res.json(link);
});

// Upload file (any format)
router.post('/file', uploadFile.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });

  const filePath = `/uploads/${req.file.filename}`;
  const { comment, imported_at, title } = req.body;
  const parsedTags = parseMultipartTags(req, res);
  if (parsedTags === null) return;

  const originalName = decodeUploadName(req.file.originalname);
  const diskPath = join(UPLOADS_DIR, req.file.filename);

  const { link, processing } = createFileItem(db, {
    userId: req.userId,
    filePath,
    diskPath,
    originalName,
    sizeBytes: req.file.size,
    title,
    comment,
    tagIds: parsedTags,
    importedAt: imported_at || new Date().toISOString(),
  });
  res.json(link);

  if (processing) enqueueFileProcessing(getRuntimeQueue(), processing);
});

// AI summarize item (calls Spark 1 vLLM)
router.post('/:id/summarize', async (req, res) => {
  try {
    const { link } = await summarizeLinkItem(db, {
      linkId: req.params.id,
      userId: req.userId,
    });
    res.json(link);
  } catch (err) {
    console.error("Summarize failed:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : "摘要失败: " + err.message });
  }
});


// Extract full page content as Markdown
router.post("/:id/extract", async (req, res) => {
  try {
    const result = await extractLinkContent(db, {
      linkId: req.params.id,
      userId: req.userId,
    });
    res.json(result);
  } catch (err) {
    console.error("Extract failed:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : "提取失败: " + err.message });
  }
});

// Update item
router.put('/:id', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!link) return res.status(404).json({ error: '不存在' });

  const { title, comment, content, tag_ids, imported_at } = req.body;
  db.prepare(`
    UPDATE links SET title = COALESCE(?, title), comment = COALESCE(?, comment),
    content = COALESCE(?, content), imported_at = COALESCE(?, imported_at) WHERE id = ?
  `).run(title ?? null, comment ?? null, content ?? null, imported_at ?? null, req.params.id);

  if (tag_ids !== undefined) setTags(req.params.id, tag_ids);
  const updated = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  res.json({ ...updated, tags: attachTags(updated.id) });
});

// Delete item
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: '不存在' });
  res.json({ ok: true });
});

// Batch import links (saves immediately, fetches metadata in background)
router.post('/import', (req, res) => {
  const { links } = req.body;
  if (!Array.isArray(links)) return res.status(400).json({ error: '请提供链接数组' });

  const { imported, toFetch } = importLinkItems(db, {
    userId: req.userId,
    items: links,
  });
  res.json({ imported });

  for (const { id, url, title } of toFetch) {
    enqueueLinkProcessing(getRuntimeQueue(), { linkId: id, url, title });
  }
});


// Export summaries as Markdown
router.get('/export/summaries', (req, res) => {
  let links;
  if (req.query.ids) {
    const ids = req.query.ids.split(',').map(Number).filter(Boolean);
    const placeholders = ids.map(() => '?').join(',');
    links = db.prepare(
      `SELECT title, url, summary, imported_at FROM links WHERE user_id = ? AND id IN (${placeholders}) AND summary != '' AND summary IS NOT NULL ORDER BY imported_at DESC`
    ).all(req.userId, ...ids);
  } else {
    links = db.prepare(
      "SELECT title, url, summary, imported_at FROM links WHERE user_id = ? AND summary != '' AND summary IS NOT NULL ORDER BY imported_at DESC"
    ).all(req.userId);
  }

  const date = new Date().toISOString().slice(0, 10);
  const NL = '\n';
  let md = '# LinkBox 摘要导出' + NL;
  md += '> 导出时间：' + date + NL + NL;
  md += '---' + NL + NL;

  links.forEach((link, i) => {
    const d = link.imported_at ? link.imported_at.slice(0, 10) : '';
    md += '## ' + (i + 1) + '. ' + (link.title || link.url) + NL;
    if (d) md += '_' + d + '_  ' + NL;
    md += '[' + link.url + '](' + link.url + ')' + NL + NL;
    md += link.summary + NL + NL;
    md += '---' + NL + NL;
  });

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="linkbox-summaries-' + date + '.md"');
  res.send(md);
});

// Export all
router.get('/export/all', (req, res) => {
  const links = db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY imported_at DESC').all(req.userId);
  const tags = db.prepare('SELECT * FROM tags WHERE user_id = ?').all(req.userId);
  const linkTags = db.prepare('SELECT lt.* FROM link_tags lt JOIN links l ON lt.link_id = l.id WHERE l.user_id = ?').all(req.userId);
  res.json({ links, tags, linkTags, exported_at: new Date().toISOString() });
});


// Generate AI learning note HTML from extracted content
router.post('/:id/learning-note', async (req, res) => {
  try {
    const result = await generateLinkLearningNote(db, {
      linkId: req.params.id,
      userId: req.userId,
      refresh: Boolean(req.query.refresh),
    });
    res.json(result);
  } catch (e) {
    console.error('learning-note error:', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : '生成失败: ' + e.message });
  }
});

export default router;
