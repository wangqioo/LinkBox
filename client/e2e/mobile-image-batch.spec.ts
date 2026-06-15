import { expect, type Page, test } from '@playwright/test';
import { createPngFixture } from './helpers/fixtures';

function uniqueUsername() {
  return `mobile-pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function registerMobileUser(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByPlaceholder('用户名').fill(uniqueUsername());
  await page.getByPlaceholder('密码', { exact: true }).fill('pass1234');
  await page.getByPlaceholder('确认密码').fill('pass1234');
  await page.getByRole('button', { name: '注册并登录' }).click();

  await expect(page.getByText('文件传输助手')).toBeVisible();
}

test('mobile multi-image upload renders one stacked image gallery', async ({ page }) => {
  await registerMobileUser(page);

  await page.locator('input[type="file"]').setInputFiles([
    createPngFixture('mobile-batch-1.png'),
    createPngFixture('mobile-batch-2.png'),
    createPngFixture('mobile-batch-3.png'),
  ]);

  const gallery = page.locator('.image-batch-card');
  await expect(gallery).toHaveCount(1);
  await expect(gallery.getByText('1 / 3')).toBeVisible();
  await expect(gallery.locator('.stack-photo')).toHaveCount(2);
  await expect(gallery.getByText('mobile-batch-1.png')).toBeVisible();
});
