import { readFileSync } from 'fs';
import db from '../db.js';
import { fetchLinkMeta } from './fetchMeta.js';
import { summarizeContent, summarizeMarkdown } from './aiSummarize.js';
import { extractPageMarkdown } from './extractContent.js';
import { describeImage, fileToMarkdown } from './fileToMarkdown.js';
import { indexLinkContent } from './chunkIndex.js';

function updateStatus(linkId, status) {
  db.prepare('UPDATE links SET status = ? WHERE id = ?').run(status, linkId);
}

function getLink(linkId) {
  return db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
}

export function registerEnrichmentJobs(queue, { uploadsDir }) {
  queue.register('link.fetchMetadata', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;

    if (!payload.title) {
      const meta = await fetchLinkMeta(payload.url || link.url);
      if (meta.title || meta.description || meta.thumbnail) {
        db.prepare('UPDATE links SET title = ?, description = ?, thumbnail = ? WHERE id = ?')
          .run(meta.title || link.url, meta.description || '', meta.thumbnail || '', linkId);
      }
    }

    queue.enqueue('link.extractMarkdown', { linkId, payload: { url: payload.url || link.url } });
  });

  queue.register('link.extractMarkdown', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;

    const extracted = await extractPageMarkdown(payload.url || link.url);
    if (!extracted?.markdown) {
      updateStatus(linkId, 'done');
      return;
    }

    db.prepare('UPDATE links SET content_md = ? WHERE id = ?').run(extracted.markdown, linkId);
    indexLinkContent(linkId);
    queue.enqueue('link.summarize', { linkId });
  });

  queue.register('link.summarize', async ({ link_id: linkId }) => {
    const link = getLink(linkId);
    if (!link) return;

    const hasMarkdown = Boolean(link.content_md?.trim());
    const text = hasMarkdown
      ? link.content_md
      : [link.title, link.description].filter(Boolean).join('\n') || link.url;
    const summary = hasMarkdown
      ? await summarizeMarkdown(text, link.title || '')
      : await summarizeContent(text, 'link');

    db.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?')
      .run(summary || link.summary || '', 'done', linkId);
  });

  queue.register('image.describe', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;

    updateStatus(linkId, 'processing');
    const description = await describeImage(payload.diskPath);
    const markdown = description
      ? `![image](${link.image_path})\n\n> 图片描述：${description}`
      : `![image](${link.image_path})`;

    db.prepare('UPDATE links SET content_md = ?, summary = ?, status = ? WHERE id = ?')
      .run(markdown, description || '', 'done', linkId);
    indexLinkContent(linkId);
  });

  queue.register('file.extractMarkdown', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;

    let rawHtml = payload.rawHtml || '';
    if (!rawHtml && payload.isHtml && payload.diskPath) {
      rawHtml = readFileSync(payload.diskPath, 'utf-8');
    }
    if (rawHtml) {
      db.prepare('UPDATE links SET html_note = ? WHERE id = ?').run(rawHtml, linkId);
    }

    const markdown = await fileToMarkdown(payload.diskPath, payload.originalName || link.title, uploadsDir);
    if (!markdown) {
      updateStatus(linkId, 'done');
      return;
    }

    const imgMatch = markdown.match(/!\[.*?\]\((\/uploads\/[^)]+)\)/);
    const thumbnail = imgMatch ? imgMatch[1] : null;
    db.prepare('UPDATE links SET content_md = ?, thumbnail = ? WHERE id = ?').run(markdown, thumbnail, linkId);
    indexLinkContent(linkId);
    queue.enqueue('file.summarize', { linkId });
  });

  queue.register('file.summarize', async ({ link_id: linkId }) => {
    const link = getLink(linkId);
    if (!link) return;

    if (!link.content_md?.trim()) {
      updateStatus(linkId, 'done');
      return;
    }

    const summary = await summarizeMarkdown(link.content_md, link.title || '');
    db.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?')
      .run(summary || link.summary || '', 'done', linkId);
  });
}
