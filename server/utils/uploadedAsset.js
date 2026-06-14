import { extname, join } from 'path';
import {
  decodeUploadName,
  describeUploadedFile,
  initialFileStatus,
  isHtmlFile,
  shouldExtractFile,
} from './linkPayloads.js';

export const IMAGE_FILE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

export function classifyUploadedAsset({ originalName = '', mimetype = '' } = {}) {
  const ext = extname(originalName).toLowerCase();
  if (mimetype.startsWith('audio/')) return 'audio';
  if (IMAGE_FILE_EXTS.has(ext)) return 'image';
  return 'file';
}

export function normalizeUploadedAsset(file, { uploadsDir = '' } = {}) {
  const originalName = decodeUploadName(file?.originalname || '');
  const filename = file?.filename || '';
  const publicPath = `/uploads/${filename}`;
  const diskPath = file?.path || (uploadsDir ? join(uploadsDir, filename) : filename);
  const sizeBytes = Number(file?.size) || 0;
  const supportedProcessing = shouldExtractFile(originalName);
  const isHtml = isHtmlFile(originalName);

  return {
    filename,
    originalName,
    publicPath,
    diskPath,
    sizeBytes,
    description: describeUploadedFile(originalName, sizeBytes),
    supportedProcessing,
    status: initialFileStatus(originalName),
    isHtml,
    uploadType: classifyUploadedAsset({
      originalName,
      mimetype: file?.mimetype || '',
    }),
    processingPayload: supportedProcessing
      ? {
          diskPath,
          originalName,
          isHtml,
        }
      : null,
  };
}
