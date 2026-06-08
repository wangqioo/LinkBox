export function enqueueLinkProcessing(queue, { linkId, url, title = '' }) {
  return queue.enqueue('link.fetchMetadata', {
    linkId,
    payload: { url, title: title || '' },
  });
}

export function enqueueImageProcessing(queue, { linkId, diskPath }) {
  return queue.enqueue('image.describe', {
    linkId,
    payload: { diskPath },
  });
}

export function enqueueFileProcessing(queue, { linkId, diskPath, originalName, isHtml = false }) {
  return queue.enqueue('file.extractMarkdown', {
    linkId,
    payload: {
      diskPath,
      originalName,
      isHtml,
    },
  });
}
