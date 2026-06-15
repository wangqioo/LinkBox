import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';
import { readDownload } from './helpers/downloads';

test('user can export collection data as JSON', async ({ page }) => {
  await registerViaUi(page);

  await page.getByRole('button', { name: /添加/ }).click();
  const addDialog = page.getByRole('dialog', { name: '添加收藏' });
  await addDialog.getByRole('button', { name: '文字' }).click();
  await addDialog.getByPlaceholder('笔记标题').fill('E2E Export Item');
  await addDialog.getByPlaceholder(/写下你的想法/).fill('export-token-884');
  await addDialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('article', { name: 'E2E Export Item' })).toBeVisible();

  await page.getByRole('button', { name: /导出/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /数据导出/ }).click();
  const download = await downloadPromise;
  const content = await readDownload(download);

  expect(download.suggestedFilename()).toMatch(/^linkbox-export-\d{4}-\d{2}-\d{2}\.json$/);
  expect(content).toContain('E2E Export Item');
  expect(content).toContain('export-token-884');
  await expect(page.getByText('JSON 导出已生成')).toBeVisible();
});
