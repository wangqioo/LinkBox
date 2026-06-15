import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';
import { createMarkdownFixture } from './helpers/fixtures';

test('user can upload a markdown file and see processing status', async ({ page }) => {
  await registerViaUi(page);
  const filePath = createMarkdownFixture();

  await page.getByRole('button', { name: /添加/ }).click();
  const addDialog = page.getByRole('dialog', { name: '添加收藏' });
  await addDialog.getByRole('button', { name: '文件' }).click();
  await addDialog.getByLabel(/选择文件/).setInputFiles(filePath);
  await addDialog.getByPlaceholder(/文件标题/).fill('E2E Markdown Upload');
  await addDialog.getByRole('button', { name: '保存' }).click();

  const uploaded = page.getByRole('article', { name: 'E2E Markdown Upload' });
  await expect(uploaded).toBeVisible();
  await expect(uploaded.getByRole('link', { name: '下载文件' })).toBeVisible();
  await expect(uploaded.getByText(/解析文件正文|生成文件摘要|处理失败|正在后台处理/).first()).toBeVisible();
});
