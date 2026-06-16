import { readFileSync } from 'fs';
import db from '../db.js';
import { fetchLinkMeta } from './fetchMeta.js';
import { summarizeContent, summarizeMarkdown } from './aiSummarize.js';
import { extractPageMarkdown } from './extractContent.js';
import { fileToMarkdown } from './fileToMarkdown.js';
import { describeImage } from './imageVisionService.js';
import { indexLinkContent } from './chunkIndex.js';
import { indexDocumentForItem } from './documentIndex.js';
import { indexMissingDocumentEmbeddingsAsync } from './documentEmbeddings.js';
import { getEmbeddingConfig } from './embeddingConfig.js';
import { persistExtractedContent } from './extractedContentPersistence.js';

export function registerEnrichmentJobs(queue, options = {}) {
  return registerEnrichmentJobsWithDeps(queue, options);
}

export function enqueueDocumentEmbedding(database, queue, linkId) {
  const existing = database.prepare(`
    SELECT id
    FROM jobs
    WHERE type = 'document.embed'
      AND link_id = ?
      AND status IN ('queued', 'running')
    LIMIT 1
  `).get(linkId);
  if (existing) return null;
  return queue.enqueue('document.embed', { linkId, maxAttempts: 2 });
}

export function registerEnrichmentJobsWithDeps(queue, {
  uploadsDir,
  db: database = db,
  fetchMetadata = fetchLinkMeta,
  extractMarkdown = extractPageMarkdown,
  convertFileToMarkdown = fileToMarkdown,
  describeUploadedImage = describeImage,
  summarizeText = summarizeContent,
  summarizeMarkdownText = summarizeMarkdown,
  embedDocuments = indexMissingDocumentEmbeddingsAsync,
  getDocumentEmbeddingConfig = getEmbeddingConfig,
} = {}) {
  function updateStatus(linkId, status) {
    database.prepare('UPDATE links SET status = ? WHERE id = ?').run(status, linkId);
  }

  function getLink(linkId) {
    return database.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
  }

  function refreshDocument(linkId) {
    const result = indexDocumentForItem(database, linkId);
    if (result.documentId) enqueueDocumentEmbedding(database, queue, linkId);
    return result;
  }

  queue.register('document.embed', async ({ link_id: linkId }) => {
    if (linkId) indexDocumentForItem(database, linkId);
    const embeddingConfig = getDocumentEmbeddingConfig({ includeSecret: true });
    if (!embeddingConfig.enabled) return;
    await embedDocuments(database, {
      provider: embeddingConfig.provider,
      model: embeddingConfig.model,
      embeddingConfig,
    });
  });

  queue.register('link.fetchMetadata', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;

    if (!payload.title) {
      const meta = await fetchMetadata(payload.url || link.url);
      if (meta.title || meta.description || meta.thumbnail) {
        database.prepare('UPDATE links SET title = ?, description = ?, thumbnail = ? WHERE id = ?')
          .run(meta.title || link.url, meta.description || '', meta.thumbnail || '', linkId);
      }
    }

    queue.enqueue('link.extractMarkdown', { linkId, payload: { url: payload.url || link.url } });
  });

  queue.register('link.extractMarkdown', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;

    const extracted = await extractMarkdown(payload.url || link.url);
    if (!extracted?.markdown) {
      persistExtractedContent(database, queue, {
        linkId,
        markdown: '',
        summarize: false,
      });
      return;
    }

    persistExtractedContent(database, queue, {
      linkId,
      markdown: extracted.markdown,
      summaryJobType: 'link.summarize',
    });
  });

  queue.register('link.summarize', async ({ link_id: linkId }) => {
    const link = getLink(linkId);
    if (!link) return;

    const hasMarkdown = Boolean(link.content_md?.trim());
    const text = hasMarkdown
      ? link.content_md
      : [link.title, link.description].filter(Boolean).join('\n') || link.url;
    const summary = hasMarkdown
      ? await summarizeMarkdownText(text, link.title || '')
      : await summarizeText(text, 'link');

    database.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?')
      .run(summary || link.summary || '', 'done', linkId);
    indexLinkContent(linkId, database);
    refreshDocument(linkId);
  });

  queue.register('image.describe', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;

    updateStatus(linkId, 'processing');
    const description = await describeUploadedImage(payload.diskPath, {
      originalName: link.title || link.image_path || '',
    });
    const markdown = description
      ? `![image](${link.image_path})\n\n> 图片描述：${description}`
      : `![image](${link.image_path})`;

    database.prepare('UPDATE links SET content_md = ?, summary = ?, status = ? WHERE id = ?')
      .run(markdown, description || '', 'done', linkId);
    indexLinkContent(linkId, database);
    refreshDocument(linkId);
  });

  queue.register('file.extractMarkdown', async ({ link_id: linkId, payload }) => {
    const link = getLink(linkId);
    if (!link) return;

    let rawHtml = payload.rawHtml || '';
    if (!rawHtml && payload.isHtml && payload.diskPath) {
      rawHtml = readFileSync(payload.diskPath, 'utf-8');
    }

    const markdown = await convertFileToMarkdown(payload.diskPath, payload.originalName || link.title, uploadsDir);
    if (!markdown) {
      persistExtractedContent(database, queue, {
        linkId,
        markdown: '',
        rawHtml,
        summarize: false,
      });
      return;
    }

    const imgMatch = markdown.match(/!\[.*?\]\((\/uploads\/[^)]+)\)/);
    const thumbnail = imgMatch ? imgMatch[1] : null;
    persistExtractedContent(database, queue, {
      linkId,
      markdown,
      rawHtml,
      thumbnail,
      summaryJobType: 'file.summarize',
    });
  });

  queue.register('file.summarize', async ({ link_id: linkId }) => {
    const link = getLink(linkId);
    if (!link) return;

    if (!link.content_md?.trim()) {
      updateStatus(linkId, 'done');
      return;
    }

    const summary = await summarizeMarkdownText(link.content_md, link.title || '');
    database.prepare('UPDATE links SET summary = ?, status = ? WHERE id = ?')
      .run(summary || link.summary || '', 'done', linkId);
    indexLinkContent(linkId, database);
    refreshDocument(linkId);
  });
}
