import { extname } from 'path';

export const SUPPORTED_FILE_EXTS = new Set([
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.doc',
  '.xls',
  '.ppt',
  '.txt',
  '.md',
  '.html',
  '.htm',
]);

export function parseTagIds(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error('not-array');
    }
    return parsed;
  } catch {
    throw new Error('tag_ids 必须是 JSON 数组');
  }
}

export function decodeUploadName(name = '') {
  if (!name) return '';
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

export function describeUploadedFile(originalName, sizeBytes) {
  const size = Number(sizeBytes) || 0;
  const formattedSize = size > 1048576
    ? (size / 1048576).toFixed(1) + ' MB'
    : (size / 1024).toFixed(0) + ' KB';
  return `${originalName} (${formattedSize})`;
}

export function shouldExtractFile(originalName) {
  return SUPPORTED_FILE_EXTS.has(extname(originalName).toLowerCase());
}

export function initialFileStatus(originalName) {
  return shouldExtractFile(originalName) ? 'processing' : 'done';
}

export function isHtmlFile(originalName) {
  return ['.html', '.htm'].includes(extname(originalName).toLowerCase());
}
