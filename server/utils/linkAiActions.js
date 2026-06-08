import {
  summarizeContent as defaultSummarizeContent,
  summarizeMarkdown as defaultSummarizeMarkdown,
} from './aiSummarize.js';
import { indexLinkContent as defaultIndexLinkContent } from './chunkIndex.js';
import { extractPageMarkdown as defaultExtractPageMarkdown } from './extractContent.js';
import { attachTags } from './linkCreateService.js';

export class LinkActionError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'LinkActionError';
    this.status = status;
  }
}

export async function summarizeLinkItem(db, {
  linkId,
  userId,
  summarizeContent = defaultSummarizeContent,
  summarizeMarkdown = defaultSummarizeMarkdown,
}) {
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(linkId, userId);
  if (!link) throw new LinkActionError(404, '不存在');
  if (!['link', 'text', 'file'].includes(link.type)) {
    throw new LinkActionError(400, '该类型不支持摘要');
  }

  let summary = '';
  if (link.type === 'text') {
    const text = [link.title, link.content].filter(Boolean).join('\n\n');
    if (!text.trim()) throw new LinkActionError(400, '没有可摘要的内容');
    summary = await summarizeContent(text, 'text');
  } else if (link.content_md && link.content_md.trim()) {
    summary = await summarizeMarkdown(link.content_md, link.title || '');
  } else {
    const text = [link.title, link.description].filter(Boolean).join('\n') || link.url;
    summary = await summarizeContent(text, 'link');
  }

  if (!summary) throw new LinkActionError(400, '没有可摘要的内容');

  db.prepare('UPDATE links SET summary = ? WHERE id = ?').run(summary, link.id);
  const updated = db.prepare('SELECT * FROM links WHERE id = ?').get(link.id);
  return { link: { ...updated, tags: attachTags(db, updated.id) } };
}

export async function extractLinkContent(db, {
  linkId,
  userId,
  extractPageMarkdown = defaultExtractPageMarkdown,
  indexLink = defaultIndexLinkContent,
}) {
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(linkId, userId);
  if (!link) throw new LinkActionError(404, '不存在');
  if (link.type !== 'link') throw new LinkActionError(400, '只有链接类型支持正文提取');
  if (!link.url) throw new LinkActionError(400, '链接地址为空');

  const result = await extractPageMarkdown(link.url);
  db.prepare('UPDATE links SET content_md = ? WHERE id = ?').run(result.markdown, link.id);
  indexLink(link.id);

  return {
    content_md: result.markdown,
    meta: {
      title: result.title,
      byline: result.byline,
      siteName: result.siteName,
      wordCount: result.wordCount,
    },
  };
}
