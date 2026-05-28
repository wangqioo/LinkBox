import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { fetchLinkMeta } from '../utils/fetchMeta.js';
import { summarizeMarkdown, summarizeContent } from '../utils/aiSummarize.js';
import { extractPageMarkdown } from '../utils/extractContent.js';
import { describeImage, fileToMarkdown } from '../utils/fileToMarkdown.js';
import { indexLinkContent, removeLinkContentIndex } from '../utils/chunkIndex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(__dirname, '../uploads');
const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.doc', '.xls', '.ppt', '.txt', '.md', '.html', '.htm']);

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

function normalizeType(link) {
  if (link.type === 'file') return 'document';
  return link.type || 'link';
}

function normalizeStatus(link) {
  if (link.status === 'processing') return 'pending';
  if (link.status === 'error') return 'failed';
  return 'ready';
}

function toMobileFile(link) {
  const title = link.title || link.url || link.file_name || `Item ${link.id}`;
  const content = link.content || link.content_md || '';
  const displaySummary = link.summary || link.description || (link.type === 'text' ? content : '');
  return {
    id: String(link.id),
    filename: title,
    original_filename: title,
    type: normalizeType(link),
    url: link.url || '',
    comment: link.comment || '',
    file_path: link.image_path || '',
    file_size: null,
    mime_type: '',
    content,
    content_md: link.content_md || '',
    has_content: Boolean(link.content_md),
    summary: displaySummary,
    description: link.description || '',
    keywords: [],
    highlights: [],
    og_image: link.thumbnail || link.image_path || '',
    favicon_url: link.url ? `/api/mobile/files/favicon?url=${encodeURIComponent(link.url)}` : '',
    created_at: link.imported_at || link.created_at,
    analyzed_at: link.imported_at || link.created_at,
    status: normalizeStatus(link),
    error: link.status === 'error' ? 'Processing failed' : null,
  };
}

function getLinkForUser(id, userId) {
  return db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(id, userId);
}

function refreshLinkIndex(linkId) {
  removeLinkContentIndex(linkId);
  return indexLinkContent(linkId);
}

async function processLink(linkId, url) {
  try {
    const meta = await fetchLinkMeta(url);
    if (meta.title || meta.description || meta.thumbnail) {
      db.prepare('UPDATE links SET title = ?, description = ?, thumbnail = ? WHERE id = ?')
        .run(meta.title || url, meta.description || '', meta.thumbnail || '', linkId);
    }
  } catch (e) {
    console.error('[mobile] meta fetch failed:', e.message);
  }

  try {
    const extracted = await extractPageMarkdown(url);
    if (extracted?.markdown) {
      db.prepare('UPDATE links SET content_md = ? WHERE id = ?').run(extracted.markdown, linkId);
      const current = db.prepare('SELECT title FROM links WHERE id = ?').get(linkId);
      const summary = await summarizeMarkdown(extracted.markdown, current?.title || url);
      db.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?').run(summary || '', 'done', linkId);
      refreshLinkIndex(linkId);
    } else {
      db.prepare('UPDATE links SET status = ? WHERE id = ?').run('done', linkId);
      refreshLinkIndex(linkId);
    }
  } catch (e) {
    console.error('[mobile] link processing failed:', e.message);
    db.prepare('UPDATE links SET status = ? WHERE id = ?').run('error', linkId);
  }
}

async function processText(linkId, title, content) {
  try {
    const summary = await summarizeContent([title, content].filter(Boolean).join('\n\n'), 'text');
    if (summary) db.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?').run(summary, 'done', linkId);
    else db.prepare('UPDATE links SET status = ? WHERE id = ?').run('done', linkId);
    refreshLinkIndex(linkId);
  } catch (e) {
    console.error('[mobile] text processing failed:', e.message);
    db.prepare('UPDATE links SET status = ? WHERE id = ?').run('error', linkId);
  }
}

async function processUploadedFile(linkId, diskPath, originalName, imagePath) {
  try {
    const ext = extname(originalName).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
      const description = await describeImage(diskPath);
      const markdown = description ? `![image](${imagePath})\n\n> Image description: ${description}` : `![image](${imagePath})`;
      db.prepare('UPDATE links SET content_md = ?, summary = ?, status = ? WHERE id = ?')
        .run(markdown, description || '', 'done', linkId);
      refreshLinkIndex(linkId);
      return;
    }

    if (!SUPPORTED_EXTS.has(ext)) {
      db.prepare('UPDATE links SET status = ? WHERE id = ?').run('done', linkId);
      return;
    }

    const markdown = await fileToMarkdown(diskPath, originalName, UPLOADS_DIR);
    if (markdown) {
      const imgMatch = markdown.match(/!\[.*?\]\((\/uploads\/[^)]+)\)/);
      const thumbnail = imgMatch ? imgMatch[1] : '';
      db.prepare('UPDATE links SET content_md = ?, thumbnail = ? WHERE id = ?').run(markdown, thumbnail, linkId);
      const current = db.prepare('SELECT title FROM links WHERE id = ?').get(linkId);
      const summary = await summarizeMarkdown(markdown, current?.title || originalName);
      db.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?').run(summary || '', 'done', linkId);
      refreshLinkIndex(linkId);
    } else {
      db.prepare('UPDATE links SET status = ? WHERE id = ?').run('done', linkId);
    }
  } catch (e) {
    console.error('[mobile] file processing failed:', e.message);
    db.prepare('UPDATE links SET status = ? WHERE id = ?').run('error', linkId);
  }
}

router.post('/upload', upload.single('file'), async (req, res) => {
  const importedAt = new Date().toISOString();

  if (req.file) {
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const filePath = `/uploads/${req.file.filename}`;
    const ext = extname(originalName).toLowerCase();
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
    const type = req.file.mimetype?.startsWith('audio/') ? 'audio' : imageExts.has(ext) ? 'image' : 'file';
    const desc = `${originalName} (${req.file.size > 1048576 ? (req.file.size / 1048576).toFixed(1) + ' MB' : (req.file.size / 1024).toFixed(0) + ' KB'})`;

    const result = db.prepare(`
      INSERT INTO links (user_id, type, url, title, description, image_path, thumbnail, imported_at, status)
      VALUES (?, ?, '', ?, ?, ?, ?, ?, 'processing')
    `).run(req.userId, type, originalName, desc, filePath, type === 'image' ? filePath : '', importedAt);

    processUploadedFile(result.lastInsertRowid, req.file.path, originalName, filePath);
    return res.json({ id: String(result.lastInsertRowid), status: 'pending', created_at: importedAt, type: normalizeType({ type }) });
  }

  const url = String(req.body?.url || '').trim();
  if (url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ error: 'Please enter a valid URL' });
    }
    const result = db.prepare(`
      INSERT INTO links (user_id, type, url, title, description, thumbnail, imported_at, status)
      VALUES (?, 'link', ?, ?, '', '', ?, 'processing')
    `).run(req.userId, url, url, importedAt);

    processLink(result.lastInsertRowid, url);
    return res.json({ id: String(result.lastInsertRowid), status: 'pending', created_at: importedAt, type: 'link' });
  }

  const text = String(req.body?.text || '').trim();
  if (text) {
    const title = text.split(/\r?\n/)[0].slice(0, 80) || 'Text note';
    const result = db.prepare(`
      INSERT INTO links (user_id, type, url, title, content, imported_at, status)
      VALUES (?, 'text', '', ?, ?, ?, 'processing')
    `).run(req.userId, title, text, importedAt);

    processText(result.lastInsertRowid, title, text);
    return res.json({ id: String(result.lastInsertRowid), status: 'pending', created_at: importedAt, type: 'text' });
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

  res.json(rows.map(toMobileFile));
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
    results: rows.map(row => ({
      ...toMobileFile(row),
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
  res.json(rows.map(toMobileFile));
});

router.get('/stats', (req, res) => {
  const rows = db.prepare('SELECT type, status, imported_at FROM links WHERE user_id = ? ORDER BY imported_at DESC').all(req.userId);
  const byType = {};
  const byStatus = {};
  for (const row of rows) {
    const type = normalizeType(row);
    const status = normalizeStatus(row);
    byType[type] = (byType[type] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  res.json({
    total: rows.length,
    by_type: byType,
    by_status: byStatus,
    recent_date: rows[0]?.imported_at?.slice(0, 10) || null,
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
  const link = getLinkForUser(req.params.id, req.userId);
  if (!link) return res.status(404).json({ error: 'Not found' });
  res.json(toMobileFile(link));
});

router.put('/:id/comment', (req, res) => {
  const comment = String(req.body?.comment || '').slice(0, 2000);
  const result = db.prepare('UPDATE links SET comment = ? WHERE id = ? AND user_id = ?')
    .run(comment, req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  const updated = getLinkForUser(req.params.id, req.userId);
  res.json(toMobileFile(updated));
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

  db.prepare('UPDATE links SET status = ? WHERE id = ?').run('processing', link.id);
  if (link.type === 'link' && link.url) await processLink(link.id, link.url);
  else if (link.type === 'text') await processText(link.id, link.title, link.content);
  else if (link.image_path) await processUploadedFile(link.id, join(UPLOADS_DIR, link.image_path.split('/').pop()), link.title, link.image_path);
  const updated = getLinkForUser(req.params.id, req.userId);
  res.json({ id: String(updated.id), status: normalizeStatus(updated), summary: updated.summary || '' });
});

export default router;
