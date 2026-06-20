export { getAutoProcessLinkUrl } from './sourceKind.ts';
import { isVideoSourceUrl } from './sourceKind.ts';

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function isUrl(text: string) {
  return /^https?:\/\/.+/i.test(text.trim());
}

export function isBilibiliVideoUrl(value: string) {
  return isVideoSourceUrl(value);
}

export function nowLocal() {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function titleFromUploadName(fileName: string) {
  const nameNoExt = fileName.replace(/\.[^.]+$/, '');
  const isHash = /^[0-9a-f]{16,}$/i.test(nameNoExt) || /^IMG_\d+$/i.test(nameNoExt);
  return isHash ? '' : nameNoExt;
}
