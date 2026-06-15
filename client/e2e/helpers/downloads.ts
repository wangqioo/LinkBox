import { readFileSync } from 'node:fs';
import type { Download } from '@playwright/test';

export async function readDownload(download: Download) {
  const path = await download.path();
  if (!path) throw new Error('Download path was not available');
  return readFileSync(path, 'utf8');
}
