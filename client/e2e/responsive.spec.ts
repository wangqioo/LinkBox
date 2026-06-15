import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';

test('primary navigation and add dialog work on mobile width', async ({ page }) => {
  await registerViaUi(page);

  await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible();
  await page.getByRole('button', { name: /添加/ }).click();
  const addDialog = page.getByRole('dialog', { name: '添加收藏' });
  await expect(addDialog).toBeVisible();
  await expect(addDialog.getByRole('button', { name: '链接' })).toBeVisible();
  await expect(addDialog.getByRole('button', { name: '文字' })).toBeVisible();
});
