import {
  createFileItem,
  createImageItem,
  createLinkItem,
  importLinkItems,
} from './linkCreateService.js';
import { getItemById, getItemForUser } from './itemRepository.js';
import { isHtmlFile } from './linkPayloads.js';
import {
  enqueueFileProcessing,
  enqueueImageProcessing,
  enqueueLinkProcessing,
} from './processingJobs.js';

function drainQueue(queue) {
  queue?.drain?.();
}

export function acceptLinkItem(db, queue, options) {
  const { link, processing } = createLinkItem(db, options);
  enqueueLinkProcessing(queue, processing);
  if (options?.drain) drainQueue(queue);
  return { link };
}

export function acceptImageItem(db, queue, options) {
  const { link, processing } = createImageItem(db, options);
  enqueueImageProcessing(queue, processing);
  if (options?.drain) drainQueue(queue);
  return { link };
}

export function acceptFileItem(db, queue, options) {
  const { link, processing } = createFileItem(db, options);
  if (processing) {
    enqueueFileProcessing(queue, processing);
    if (options?.drain) drainQueue(queue);
  }
  return { link };
}

export function acceptImportedLinkItems(db, queue, options) {
  const { imported, toFetch } = importLinkItems(db, options);
  for (const { id, url, title } of toFetch) {
    enqueueLinkProcessing(queue, { linkId: id, url, title });
  }
  if (options?.drain && toFetch.length) drainQueue(queue);
  return { imported };
}

export function retryItemProcessing(db, queue, { linkId, userId }) {
  const link = getItemForUser(db, { linkId, userId });
  if (!link) {
    const error = new Error('Item not found');
    error.status = 404;
    throw error;
  }

  const retried = queue.retryFailedJobsForLink(link.id);
  if (!retried) {
    const error = new Error('No failed jobs to retry');
    error.status = 409;
    throw error;
  }

  db.prepare('UPDATE links SET status = ? WHERE id = ?').run('processing', link.id);
  drainQueue(queue);

  return {
    link: getItemById(db, link.id),
    retried,
  };
}

export function scheduleItemProcessing(db, queue, { linkId, userId, diskPath = null, drain = false }) {
  const link = getItemForUser(db, { linkId, userId });
  if (!link) {
    const error = new Error('Item not found');
    error.status = 404;
    throw error;
  }

  db.prepare('UPDATE links SET status = ? WHERE id = ?').run('processing', link.id);

  if (link.type === 'link' && link.url) {
    enqueueLinkProcessing(queue, { linkId: link.id, url: link.url, title: '' });
  } else if (link.type === 'image' && diskPath) {
    enqueueImageProcessing(queue, { linkId: link.id, diskPath });
  } else if (link.type === 'file' && diskPath) {
    enqueueFileProcessing(queue, {
      linkId: link.id,
      diskPath,
      originalName: link.title,
      isHtml: isHtmlFile(link.title),
    });
  } else {
    const error = new Error('Unsupported item type for processing');
    error.status = 400;
    throw error;
  }

  if (drain) drainQueue(queue);

  return {
    link: getItemById(db, link.id),
  };
}
