const TYPE_LABELS = {
  link: 'Link',
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
  document: 'Document',
  file: 'Document',
};

const STATUS_LABELS = {
  idle: 'Ready',
  done: 'Done',
  queued: 'Queued',
  running: 'Processing',
  processing: 'Processing',
  failed: 'Failed',
  error: 'Failed',
};

function displayType(item) {
  return item.type === 'file' ? 'document' : item.type || 'link';
}

function displayStatus(item) {
  const state = item.processing?.state;
  if (state && state !== 'idle') return state;
  return item.status || 'idle';
}

function primaryAssetUrl(item) {
  if (item.image_path) return item.image_path;
  if (item.thumbnail) return item.thumbnail;
  return '';
}

export function presentItem(item = {}) {
  const type = displayType(item);
  const status = displayStatus(item);

  return {
    ...item,
    display: {
      type,
      typeLabel: TYPE_LABELS[type] || type,
      status,
      statusLabel: STATUS_LABELS[status] || status,
      canRetry: Boolean(item.processing?.canRetry),
      canAnalyze: ['link', 'image', 'document'].includes(type),
      primaryAssetUrl: primaryAssetUrl(item),
    },
  };
}
