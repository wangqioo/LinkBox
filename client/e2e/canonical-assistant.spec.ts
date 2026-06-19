import { expect, test } from '@playwright/test';
import { loginAsAdminViaUi } from './helpers/auth';
import { createTextFixture } from './helpers/fixtures';

async function runDiagnosticsUntilCanonicalSource(page: import('@playwright/test').Page) {
  const queryResult = page.getByText(/Query：e2e-canonical-token-731 是什么？/);
  const canonicalSource = page.getByText(/^1\. E2E Canonical Only Source$/);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.getByRole('button', { name: /运行诊断/ }).click();
    await expect(queryResult).toBeVisible({ timeout: 15000 });
    if (await canonicalSource.isVisible()) return;
    await page.waitForTimeout(1000);
  }

  await expect(canonicalSource).toBeVisible();
}

test('retrieval diagnostics uses canonical documents when legacy fallback is disabled', async ({ page }) => {
  await loginAsAdminViaUi(page);
  const filePath = createTextFixture(
    'canonical-only-note.md',
    '# Canonical Only Retrieval\n\nThe canonical-only browser test should find e2e-canonical-token-731 from document chunks.',
  );

  await page.getByRole('button', { name: /添加/ }).click();
  const addDialog = page.getByRole('dialog', { name: '添加收藏' });
  await addDialog.getByRole('button', { name: '文件' }).click();
  await addDialog.getByLabel(/选择文件/).setInputFiles(filePath);
  await addDialog.getByPlaceholder(/文件标题/).fill('E2E Canonical Only Source');
  await addDialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('article', { name: 'E2E Canonical Only Source' })).toBeVisible();

  await page.getByRole('link', { name: /系统设置/ }).click();
  await expect(page.getByRole('heading', { name: '检索诊断' })).toBeVisible();
  await page.getByLabel('查询').fill('e2e-canonical-token-731 是什么？');

  await runDiagnosticsUntilCanonicalSource(page);
  await expect(page.getByText(/document · keyword/)).toBeVisible();
  await expect(page.getByText(/The canonical-only browser test should find e2e-canonical-token-731/)).toBeVisible();
});
