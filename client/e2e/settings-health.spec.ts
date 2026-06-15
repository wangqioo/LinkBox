import { expect, test } from '@playwright/test';
import { loginAsAdminViaUi } from './helpers/auth';

test('admin can view system health checks in settings', async ({ page }) => {
  await loginAsAdminViaUi(page);

  await page.getByRole('link', { name: /系统设置/ }).click();

  await expect(page.getByRole('heading', { name: '系统健康' })).toBeVisible();
  await expect(page.getByText(/状态：(健康|降级|异常|未知)/)).toBeVisible();
  await expect(page.getByText('SQLite', { exact: true })).toBeVisible();
  await expect(page.getByText('Uploads', { exact: true })).toBeVisible();
  await expect(page.getByText('Queue', { exact: true })).toBeVisible();
  await expect(page.getByText('AI Endpoint', { exact: true })).toBeVisible();
  await expect(page.getByText('pdftotext', { exact: true })).toBeVisible();
  await expect(page.getByText('LibreOffice', { exact: true })).toBeVisible();
});
