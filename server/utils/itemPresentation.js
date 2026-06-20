import { itemKindForRow } from './itemKind.js';
import { materialForItem } from './itemMaterial.js';

const TYPE_LABELS = {
  link: 'Link',
  article: 'Article',
  video: 'Video',
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
  return itemKindForRow(item);
}

function displayStatus(item) {
  const state = item.processing?.state;
  if (state && state !== 'idle') return state;
  return item.status || 'idle';
}

function primaryAssetUrl(item) {
  return materialForItem(item).primaryAssetUrl;
}

export function presentItem(item = {}) {
  const type = displayType(item);
  const status = displayStatus(item);
  const material = materialForItem(item);

  return {
    ...item,
    material,
    display: {
      type,
      typeLabel: TYPE_LABELS[type] || type,
      status,
      statusLabel: STATUS_LABELS[status] || status,
      canRetry: Boolean(item.processing?.canRetry),
      canAnalyze: ['link', 'article', 'video', 'image', 'document'].includes(type),
      primaryAssetUrl: primaryAssetUrl(item),
    },
  };
}
