const ACTIVE_PROCESSING_STATES = new Set(['queued', 'running', 'processing']);
const FILE_SIZE_UNITS = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

export function normalizeMobileType(link = {}) {
  if (link.type === 'file') return 'document';
  return link.type || 'link';
}

export function normalizeMobileStatus(link = {}) {
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
  const title = link.title || link.url || link.file_name || `Item ${link.id}`;
  const content = link.content || link.content_md || '';
  const displaySummary = link.summary || link.description || (link.type === 'text' ? content : '');
  const status = normalizeMobileStatus(link);

  return {
    id: String(link.id),
    filename: title,
    original_filename: title,
    type: normalizeMobileType(link),
    url: link.url || '',
    comment: link.comment || '',
    file_path: link.image_path || '',
    file_size: parseMobileFileSize(link),
    mime_type: '',
    content,
    content_md: link.content_md || '',
    has_content: Boolean(link.content_md),
    summary: displaySummary,
    description: link.description || '',
    keywords: [],
    highlights: [],
    og_image: link.thumbnail || link.image_path || '',
    favicon_url: link.url ? `/api/mobile/files/favicon?url=${encodeURIComponent(link.url)}` : '',
    created_at: link.imported_at || link.created_at,
    analyzed_at: link.imported_at || link.created_at,
    status,
    processing: link.processing || null,
    error: status === 'failed'
      ? link.processing?.lastError || 'Processing failed'
      : null,
  };
}
