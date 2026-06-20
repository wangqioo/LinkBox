import { indexLinkContent } from './chunkIndex.js';
import { indexDocumentForItem } from './documentIndex.js';
import { followupEnrichmentJobs } from './itemEnrichmentPlan.js';
import { upsertItemAsset } from './itemAssetStore.js';
import { upsertItemContent } from './itemContentStore.js';

function linkColumns(db) {
  return new Set(db.prepare('PRAGMA table_info(links)').all().map(column => column.name));
}

function persistExtractionFields(db, {
  linkId,
  markdown,
  rawHtml,
  thumbnail,
  includeMarkdown,
  status,
}) {
  const columns = linkColumns(db);
  const updates = [];
  const params = [];

  if (includeMarkdown) {
    updates.push('content_md = ?');
    params.push(markdown);
  }
  if (columns.has('html_note') && rawHtml) {
    updates.push('html_note = ?');
    params.push(rawHtml);
  }
  if (columns.has('thumbnail') && thumbnail !== null && thumbnail !== undefined) {
    updates.push('thumbnail = ?');
    params.push(thumbnail);
  }
  if (status) {
    updates.push('status = ?');
    params.push(status);
  }
  if (!updates.length) return;
  db.prepare(`UPDATE links SET ${updates.join(', ')} WHERE id = ?`).run(...params, linkId);
}

function enqueueDocumentEmbedding(db, queue, linkId) {
  const existing = db.prepare(`
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

function enqueueFollowupJob(db, queue, job) {
  if (!job || !queue) return null;
  if (job.type === 'document.embed') return enqueueDocumentEmbedding(db, queue, job.linkId);
  return queue.enqueue(job.type, {
    linkId: job.linkId,
    payload: job.payload,
    maxAttempts: job.maxAttempts,
  });
}

export function persistExtractedContent(db, queue, {
  linkId,
  markdown = '',
  rawHtml = '',
  thumbnail = null,
  summarize = true,
  summaryJobType = 'link.summarize',
  indexLink = (linkId) => indexLinkContent(linkId, db),
  indexDocument = indexDocumentForItem,
} = {}) {
  const cleanMarkdown = String(markdown || '');

  if (!cleanMarkdown.trim()) {
    persistExtractionFields(db, {
      linkId,
      markdown: cleanMarkdown,
      rawHtml,
      thumbnail,
      includeMarkdown: false,
      status: 'done',
    });
    upsertItemContent(db, linkId, { html_note: rawHtml || '' });
    return { stored: false, document: null, summaryQueued: false };
  }

  persistExtractionFields(db, {
    linkId,
    markdown: cleanMarkdown,
    rawHtml,
    thumbnail,
    includeMarkdown: true,
  });
  upsertItemContent(db, linkId, {
    extracted_markdown: cleanMarkdown,
    html_note: rawHtml || undefined,
  });
  upsertItemAsset(db, linkId, {
    kind: 'thumbnail',
    publicPath: thumbnail || '',
    metadata: { source: 'persistExtractedContent.thumbnail' },
  });

  indexLink(linkId);
  const document = indexDocument(db, linkId);
  const followups = followupEnrichmentJobs({
    linkId,
    summarize,
    summaryJobType,
    documentId: document?.documentId || null,
  });
  for (const job of followups) enqueueFollowupJob(db, queue, job);

  return {
    stored: true,
    document,
    summaryQueued: Boolean(summarize && queue),
  };
}
