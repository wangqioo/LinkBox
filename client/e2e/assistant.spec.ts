import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';

test('assistant answers from the user collection with visible citations', async ({ page }) => {
  await registerViaUi(page);

  await page.getByRole('button', { name: /添加/ }).click();
  const addDialog = page.getByRole('dialog', { name: '添加收藏' });
  await addDialog.getByRole('button', { name: '文字' }).click();
  await addDialog.getByPlaceholder('笔记标题').fill('E2E Assistant Source');
  await addDialog.getByPlaceholder(/写下你的想法/).fill('The assistant should find e2e-assistant-token-515 in this source.');
  await addDialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('article', { name: 'E2E Assistant Source' })).toBeVisible();

  await page.getByRole('link', { name: /资料助理/ }).click();
  await page.getByPlaceholder(/问一个|总结|报告|整理|待办/).fill('e2e-assistant-token-515 是什么？');
  await page.getByRole('button', { name: /发送/ }).click();

  await expect(page.getByText(/Playwright mock AI 回答/)).toBeVisible();
  await expect(page.getByRole('button', { name: /引用资料/ })).toBeVisible();
});
