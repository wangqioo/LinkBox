import {
  summarizeContent as defaultSummarizeContent,
  summarizeMarkdown as defaultSummarizeMarkdown,
} from './aiSummarize.js';
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
