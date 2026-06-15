import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

export function createTextFixture(name: string, content: string) {
  const filePath = join(test.info().outputDir, name);
  writeFileSync(filePath, content);
  return filePath;
}
