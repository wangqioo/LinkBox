import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';

test('user can create, search, update, and delete a text item', async ({ page }) => {
  await registerViaUi(page);

  const suffix = Date.now();
  const title = `E2E Text Note ${suffix}`;
  const updatedTitle = `E2E Text Note Updated ${suffix}`;
  const body = `Playwright text note body with searchable-token-${suffix}.`;
  const updatedBody = `Updated Playwright text note body ${suffix}.`;

  await page.getByRole('button', { name: /添加/ }).click();
  const addDialog = page.getByRole('dialog', { name: '添加收藏' });
  await expect(addDialog).toBeVisible();
  await addDialog.getByRole('button', { name: '文字' }).click();
  await page.getByPlaceholder('笔记标题').fill(title);
  await page.getByPlaceholder(/写下你的想法/).fill(body);
  await page.getByRole('button', { name: '保存' }).click();

  await expect(page.getByRole('article', { name: title })).toBeVisible();

  await page.getByLabel('搜索收藏').fill(`searchable-token-${suffix}`);
  await expect(page.getByRole('article', { name: title })).toBeVisible();

  const note = page.getByRole('article', { name: title });
  await note.getByRole('button', { name: /编辑收藏/ }).click();
  await note.getByLabel('编辑标题').fill(updatedTitle);
  await note.getByLabel('编辑内容').fill(updatedBody);
  await note.getByRole('button', { name: '保存' }).click();

  await expect(page.getByRole('article', { name: updatedTitle })).toBeVisible();
  await expect(page.getByText(updatedBody)).toBeVisible();

  await page.getByLabel('搜索收藏').fill('');
  const updatedNote = page.getByRole('article', { name: updatedTitle });
  await expect(updatedNote).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: new RegExp(`删除收藏 ${updatedTitle}`) }).click();

  await expect(page.getByRole('article', { name: updatedTitle })).toHaveCount(0);
});
