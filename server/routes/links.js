import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { fetchLinkMeta } from '../utils/fetchMeta.js';
import { summarizeContent, summarizeMarkdown } from '../utils/aiSummarize.js';
import { generateLearningNote } from '../utils/generateLearningNote.js';
import { extractPageMarkdown } from '../utils/extractContent.js';
import { fileToMarkdown } from '../utils/fileToMarkdown.js';

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
  return db.prepare('SELECT t.* FROM tags t JOIN link_tags lt ON t.id = lt.tag_id WHERE lt.link_id = ?').all(linkId);
}

function setTags(linkId, tagIds) {
  db.prepare('DELETE FROM link_tags WHERE link_id = ?').run(linkId);
  if (tagIds?.length) {
    const stmt = db.prepare('INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)');
    for (const tid of tagIds) stmt.run(linkId, tid);
  }
}

// List items with filters
router.get('/', (req, res) => {
  const { tag, search, from, to, type, page = 1, limit = 50 } = req.query;
  let sql = `SELECT DISTINCT l.* FROM links l`;
  let countSql = `SELECT COUNT(DISTINCT l.id) as total FROM links l`;
  const params = [];
  const conditions = ['l.user_id = ?'];
  params.push(req.userId);

  if (tag) {
    sql += ` JOIN link_tags lt ON l.id = lt.link_id JOIN tags t ON lt.tag_id = t.id`;
    countSql += ` JOIN link_tags lt ON l.id = lt.link_id JOIN tags t ON lt.tag_id = t.id`;
    conditions.push('t.id = ?');
    params.push(tag);
  }
  if (type) { conditions.push('l.type = ?'); params.push(type); }
  if (search) {
    conditions.push(`(l.title LIKE ? OR l.url LIKE ? OR l.comment LIKE ? OR l.content LIKE ?)`);
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (from) { conditions.push('l.imported_at >= ?'); params.push(from); }
  if (to) { conditions.push('l.imported_at <= ?'); params.push(to + ' 23:59:59'); }

  const where = ' WHERE ' + conditions.join(' AND ');
  sql += where + ` ORDER BY l.imported_at DESC LIMIT ? OFFSET ?`;
  countSql += where;

  const offset = (Number(page) - 1) * Number(limit);
  const countParams = [...params];
  params.push(Number(limit), offset);

  const links = db.prepare(sql).all(...params);
  const { total } = db.prepare(countSql).get(...countParams);
  const tagStmt = db.prepare('SELECT t.* FROM tags t JOIN link_tags lt ON t.id = lt.tag_id WHERE lt.link_id = ?');
  const result = links.map(link => ({ ...link, tags: tagStmt.all(link.id) }));

  res.json({ links: result, total, page: Number(page), limit: Number(limit) });
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

  // Save immediately with URL as fallback title
  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, description, thumbnail, comment, imported_at, status)
    VALUES (?, 'link', ?, ?, '', '', ?, ?, 'processing')
  `).run(req.userId, url, title || url, comment || '', imported_at || new Date().toISOString());

  if (tag_ids?.length) setTags(result.lastInsertRowid, tag_ids);
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...link, tags: attachTags(link.id) });

  // Background pipeline: fetchMeta → extractContent → summarize
  (async () => {
    const linkId = result.lastInsertRowid;
    try {
      // Step 1: fetch page metadata
      if (!title) {
        const meta = await fetchLinkMeta(url);
        if (meta.title || meta.description || meta.thumbnail) {
          db.prepare(`UPDATE links SET title = ?, description = ?, thumbnail = ? WHERE id = ?`)
            .run(meta.title || url, meta.description || '', meta.thumbnail || '', linkId);
        }
      }
    } catch (e) { console.error('[bg] meta fetch failed:', e.message); }

    try {
      // Step 2: extract page content as markdown
      const extracted = await extractPageMarkdown(url);
      if (extracted?.markdown) {
        db.prepare(`UPDATE links SET content_md = ? WHERE id = ?`)
          .run(extracted.markdown, linkId);

        // Step 3: summarize using local AI (Qwen2.5-VL-3B)
        try {
          const currentLink = db.prepare('SELECT title FROM links WHERE id = ?').get(linkId);
          const summary = await summarizeMarkdown(extracted.markdown, currentLink?.title || url);
          if (summary) {
            db.prepare(`UPDATE links SET summary = ?, status = 'done' WHERE id = ?`).run(summary, linkId);
          } else {
            db.prepare(`UPDATE links SET status = 'done' WHERE id = ?`).run(linkId);
          }
        } catch (e) {
          console.error('[bg] summarize failed:', e.message);
          db.prepare(`UPDATE links SET status = 'done' WHERE id = ?`).run(linkId);
        }
      } else {
        db.prepare(`UPDATE links SET status = 'done' WHERE id = ?`).run(linkId);
      }
    } catch (e) {
      console.error('[bg] extract failed:', e.message);
      db.prepare(`UPDATE links SET status = 'error' WHERE id = ?`).run(linkId);
    }
  })();
});

// Add text note
router.post('/text', (req, res) => {
  const { title, content, comment, tag_ids, imported_at } = req.body;
  if (!content && !title) return res.status(400).json({ error: '标题或内容不能为空' });

  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, content, comment, imported_at)
    VALUES (?, 'text', '', ?, ?, ?, ?)
  `).run(req.userId, title || '', content || '', comment || '', imported_at || new Date().toISOString());

  if (tag_ids?.length) setTags(result.lastInsertRowid, tag_ids);
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...link, tags: attachTags(link.id) });
});

// Upload image
router.post('/image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传图片' });

  const imagePath = `/uploads/${req.file.filename}`;
  const { comment, tag_ids, imported_at, title } = req.body;
  const parsedTags = tag_ids ? JSON.parse(tag_ids) : [];

  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, image_path, thumbnail, comment, imported_at)
    VALUES (?, 'image', '', ?, ?, ?, ?, ?)
  `).run(req.userId, title || Buffer.from(req.file.originalname, 'latin1').toString('utf8'), imagePath, imagePath, comment || '', imported_at || new Date().toISOString());

  if (parsedTags.length) setTags(result.lastInsertRowid, parsedTags);
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...link, tags: attachTags(link.id) });
});

// Upload audio
router.post('/audio', uploadAudio.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传录音' });

  const audioPath = `/uploads/${req.file.filename}`;
  const { comment, tag_ids, imported_at, title } = req.body;
  const parsedTags = tag_ids ? JSON.parse(tag_ids) : [];

  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, image_path, comment, imported_at)
    VALUES (?, 'audio', '', ?, ?, ?, ?)
  `).run(req.userId, title || '录音', audioPath, comment || '', imported_at || new Date().toISOString());

  if (parsedTags.length) setTags(result.lastInsertRowid, parsedTags);
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...link, tags: attachTags(link.id) });
});

const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.doc', '.xls', '.ppt', '.txt', '.md', '.html', '.htm']);

// Upload file (any format)
router.post('/file', uploadFile.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });

  const filePath = `/uploads/${req.file.filename}`;
  const { comment, tag_ids, imported_at, title } = req.body;
  const parsedTags = tag_ids ? JSON.parse(tag_ids) : [];

  const fileSize = req.file.size;
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const desc = `${originalName} (${fileSize > 1048576 ? (fileSize / 1048576).toFixed(1) + ' MB' : (fileSize / 1024).toFixed(0) + ' KB'})`;

  const ext = extname(originalName).toLowerCase();
  const initialStatus = SUPPORTED_EXTS.has(ext) ? 'processing' : 'done';
  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, description, image_path, comment, imported_at, status)
    VALUES (?, 'file', '', ?, ?, ?, ?, ?, ?)
  `).run(req.userId, title || originalName, desc, filePath, comment || '', imported_at || new Date().toISOString(), initialStatus);

  if (parsedTags.length) setTags(result.lastInsertRowid, parsedTags);
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...link, tags: attachTags(link.id) });

  // Background: extract content from supported file types
  if (SUPPORTED_EXTS.has(ext)) {
    const linkId = result.lastInsertRowid;
    const diskPath = join(UPLOADS_DIR, req.file.filename);
    const uploadsDir = UPLOADS_DIR;
    (async () => {
      try {
        const isHtml = ['.html', '.htm'].includes(ext);
        if (isHtml) {
          const { readFileSync } = await import('fs');
          const rawHtml = readFileSync(diskPath, 'utf-8');
          db.prepare('UPDATE links SET html_note = ? WHERE id = ?').run(rawHtml, linkId);
        }
        const markdown = await fileToMarkdown(diskPath, originalName, uploadsDir);
        if (markdown) {
          const imgMatch = markdown.match(/!\[.*?\]\((\/uploads\/[^)]+)\)/);
          const thumbnail = imgMatch ? imgMatch[1] : null;
          db.prepare('UPDATE links SET content_md = ?, thumbnail = ? WHERE id = ?').run(markdown, thumbnail, linkId);
          try {
            const currentLink = db.prepare('SELECT title FROM links WHERE id = ?').get(linkId);
            const summary = await summarizeMarkdown(markdown, currentLink?.title || originalName);
            if (summary) {
              db.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?').run(summary, 'done', linkId);
            } else {
              db.prepare('UPDATE links SET status = ? WHERE id = ?').run('done', linkId);
            }
          } catch (e) {
            console.error('[bg] file summarize failed:', e.message);
            db.prepare('UPDATE links SET status = ? WHERE id = ?').run('done', linkId);
          }
        } else {
          db.prepare('UPDATE links SET status = ? WHERE id = ?').run('done', linkId);
        }
      } catch (e) {
        console.error('[bg] fileToMarkdown failed:', e.message);
        db.prepare('UPDATE links SET status = ? WHERE id = ?').run('error', linkId);
      }
    })();
  }
});

// AI summarize item (calls Spark 1 vLLM)
router.post('/:id/summarize', async (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!link) return res.status(404).json({ error: '不存在' });
  if (!['link', 'text', 'file'].includes(link.type)) {
    return res.status(400).json({ error: '该类型不支持摘要' });
  }

  let textToSummarize = '';
  if (link.type === 'text') {
    textToSummarize = [link.title, link.content].filter(Boolean).join('\n\n');
  } else if (link.type === 'file') {
    textToSummarize = link.content_md || [link.title, link.description].filter(Boolean).join('\n');
  } else {
    // For links: combine title + description; if too short, note the URL
    textToSummarize = [link.title, link.description].filter(Boolean).join('\n') || link.url;
  }

  if (!textToSummarize.trim()) return res.status(400).json({ error: '没有可摘要的内容' });

  try {
    const summary = await summarizeContent(textToSummarize, link.type);
    db.prepare("UPDATE links SET summary = ? WHERE id = ?").run(summary, link.id);
    const updated = db.prepare("SELECT * FROM links WHERE id = ?").get(link.id);
    res.json({ ...updated, tags: attachTags(updated.id) });
  } catch (err) {
    console.error("Summarize failed:", err.message);
    res.status(500).json({ error: "摘要失败: " + err.message });
  }
});


// Extract full page content as Markdown
router.post("/:id/extract", async (req, res) => {
  const link = db.prepare("SELECT * FROM links WHERE id = ? AND user_id = ?").get(req.params.id, req.userId);
  if (!link) return res.status(404).json({ error: "不存在" });
  if (link.type !== "link") return res.status(400).json({ error: "只有链接类型支持正文提取" });
  if (!link.url) return res.status(400).json({ error: "链接地址为空" });
  try {
    const result = await extractPageMarkdown(link.url);
    db.prepare("UPDATE links SET content_md = ? WHERE id = ?").run(result.markdown, link.id);
    res.json({ content_md: result.markdown, meta: {
      title: result.title, byline: result.byline,
      siteName: result.siteName, wordCount: result.wordCount
    }});
  } catch (err) {
    console.error("Extract failed:", err.message);
    res.status(500).json({ error: "提取失败: " + err.message });
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

  const imported = [];
  const toFetch = [];
  for (const item of links) {
    const url = typeof item === 'string' ? item : item.url;
    if (!url) continue;
    const result = db.prepare(`
      INSERT INTO links (user_id, type, url, title, description, thumbnail, comment, imported_at)
      VALUES (?, 'link', ?, ?, '', '', ?, ?)
    `).run(req.userId, url, item.title || url, item.comment || '', item.imported_at || new Date().toISOString());
    imported.push(result.lastInsertRowid);
    if (!item.title) toFetch.push({ id: result.lastInsertRowid, url });
  }
  res.json({ imported: imported.length });

  // Background metadata fetch for all imported links
  for (const { id, url } of toFetch) {
    fetchLinkMeta(url).then(meta => {
      if (meta.title || meta.description || meta.thumbnail) {
        db.prepare(`UPDATE links SET title = ?, description = ?, thumbnail = ? WHERE id = ?`)
          .run(meta.title || url, meta.description || '', meta.thumbnail || '', id);
      }
    }).catch(err => {
      console.error('Background meta fetch failed for', url, err.message);
    });
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
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!link) return res.status(404).json({ error: '不存在' });
  if (!link.content_md) return res.status(400).json({ error: '请先提取正文' });

  // Return cached if exists and not forced refresh
  if (link.html_note && !req.query.refresh) {
    return res.json({ html_note: link.html_note });
  }

  try {
    const html = await generateLearningNote(link.content_md, link.title, link.summary);
    db.prepare('UPDATE links SET html_note = ? WHERE id = ?').run(html, link.id);
    res.json({ html_note: html });
  } catch (e) {
    console.error('learning-note error:', e.message);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

export default router;
