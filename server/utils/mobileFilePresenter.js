import { presentItem } from './itemPresentation.js';

const ACTIVE_PROCESSING_STATES = new Set(['queued', 'running', 'processing']);
const FILE_SIZE_UNITS = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

export function normalizeMobileType(link = {}) {
  if (link.display?.type) return link.display.type;
  if (link.type === 'file') return 'document';
  return link.type || 'link';
}

export function normalizeMobileStatus(link = {}) {
  if (link.display?.status) {
    if (link.display.status === 'failed' || link.display.status === 'error') return 'failed';
    if (ACTIVE_PROCESSING_STATES.has(link.display.status)) return 'pending';
    return 'ready';
  }
  const state = link.processing?.state || '';
  if (state === 'failed' || link.status === 'error') return 'failed';
  if (ACTIVE_PROCESSING_STATES.has(state) || link.status === 'processing') return 'pending';
  return 'ready';
}

export function parseMobileFileSize(link = {}) {
  if (link.file_size !== undefined && link.file_size !== null && link.file_size !== '') {
    const explicitSize = Number(link.file_size);
    if (Number.isFinite(explicitSize)) return explicitSize;
  }

  const match = String(link.description || '').match(/\(([\d.]+)\s*(B|KB|MB|GB)\)$/i);
  if (!match) return null;

  const value = Number(match[1]);
  const unit = FILE_SIZE_UNITS[match[2].toUpperCase()];
  if (!Number.isFinite(value) || !unit) return null;
  return Math.round(value * unit);
}

export function toMobileFile(link = {}) {
  const item = presentItem(link);
  const title = item.title || item.url || item.file_name || `Item ${item.id}`;
  const material = item.material || {};
  const content = material.textContent || material.extractedMarkdown || '';
  const displaySummary = material.summary || item.description || (item.type === 'text' ? content : '');
  const status = normalizeMobileStatus(item);
  const assetUrl = material.primaryAssetUrl || item.display.primaryAssetUrl;

  return {
    id: String(item.id),
    filename: title,
    original_filename: title,
    type: normalizeMobileType(item),
    url: item.url || assetUrl,
    comment: item.comment || '',
    file_path: item.image_path || '',
    file_size: parseMobileFileSize(item),
    mime_type: '',
    batch_id: item.batch_id || '',
    batch_index: Number(item.batch_index || 0),
    content,
    content_md: material.extractedMarkdown || item.content_md || '',
    has_content: Boolean(material.hasExtractedMarkdown),
    summary: displaySummary,
    description: item.description || '',
    keywords: [],
    highlights: [],
    og_image: material.thumbnailUrl || item.thumbnail || item.image_path || '',
    favicon_url: item.url ? `/api/mobile/files/favicon?url=${encodeURIComponent(item.url)}` : '',
    created_at: item.imported_at || item.created_at,
    analyzed_at: item.imported_at || item.created_at,
    status,
    processing: item.processing || null,
    can_retry: item.display.canRetry,
    recovery_hint: item.processing?.recoveryHint || '',
    error: status === 'failed'
      ? item.processing?.lastError || 'Processing failed'
      : null,
  };
}
