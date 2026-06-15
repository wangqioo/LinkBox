import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

export function createTextFixture(name: string, content: string) {
  const filePath = join(test.info().outputDir, name);
  mkdirSync(test.info().outputDir, { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}

export function createMarkdownFixture(name = 'playwright-note.md') {
  return createTextFixture(
    name,
    '# Playwright Upload\n\nThis uploaded markdown file contains e2e-upload-token-942.',
  );
}

export function createPngFixture(name = 'playwright-image.png') {
  const filePath = join(test.info().outputDir, name);
  mkdirSync(test.info().outputDir, { recursive: true });
  writeFileSync(
    filePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lVUN8wAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  return filePath;
}
