import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('canonical-only E2E has an explicit script and backend fallback gate', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    packageJson.scripts['test:e2e:canonical'],
    'playwright test --config playwright.canonical.config.ts',
  );

  const config = readFileSync(new URL('../playwright.canonical.config.ts', import.meta.url), 'utf8');
  assert.match(config, /ASSISTANT_ENABLE_LEGACY_FALLBACK:\s*'0'/);
  assert.match(config, /canonical-assistant\\\.spec\\\.ts/);
  assert.match(config, /3311/);
  assert.match(config, /5176/);
});
