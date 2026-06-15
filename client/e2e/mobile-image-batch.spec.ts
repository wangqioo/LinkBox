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

test('mobile image batch keeps ai failure details compact in the feed', async ({ page }) => {
  const rawError = 'Vision LLM returned 400: {"error":{"message":"image payload rejected by upstream vision model"}}';
  const longSummary = '这是一段很长的 AI 图片分析结果，包含拍摄场景、物体识别、可能的行动建议和大量上下文，只应该在详情页完整阅读。';
  const files = [
    {
      id: '9201',
      original_filename: 'ai-error-1.jpeg',
      filename: 'ai-error-1.jpeg',
      type: 'image',
      file_size: 2048,
      batch_id: 'ai-feed-batch',
      batch_index: 0,
      created_at: new Date().toISOString(),
      status: 'failed',
      error: rawError,
      processing: { state: 'failed', lastError: rawError },
      summary: longSummary,
    },
    {
      id: '9202',
      original_filename: 'ai-error-2.jpeg',
      filename: 'ai-error-2.jpeg',
      type: 'image',
      file_size: 2048,
      batch_id: 'ai-feed-batch',
      batch_index: 1,
      created_at: new Date().toISOString(),
      status: 'failed',
      error: rawError,
      processing: { state: 'failed', lastError: rawError },
      summary: longSummary,
    },
  ];

  await page.route('**/api/mobile/files/stats', route => route.fulfill({
    json: {
      total: files.length,
      by_type: { image: files.length },
      by_status: { failed: files.length },
      recent_date: new Date().toISOString().slice(0, 10),
    },
  }));
  await page.route(/\/api\/mobile\/files\?/, route => route.fulfill({ json: files }));
  await page.route(/\/api\/mobile\/files\/920[12]\/download/, route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
  }));

  await registerMobileUser(page);

  const gallery = page.locator('.image-batch-card');
  await expect(gallery).toBeVisible();
  await expect(gallery.locator('.batch-status')).toHaveText('AI 分析失败');
  await expect(gallery).not.toContainText('Vision LLM returned 400');

  await expect.poll(async () => gallery.locator('.batch-status').evaluate(
    element => getComputedStyle(element).getPropertyValue('-webkit-line-clamp'),
  )).toBe('1');
  await expect.poll(async () => gallery.locator('.batch-status').evaluate(
    element => getComputedStyle(element).fontSize,
  )).toBe('9px');
  await expect.poll(async () => gallery.locator('.batch-summary').evaluate(
    element => getComputedStyle(element).getPropertyValue('-webkit-line-clamp'),
  )).toBe('1');
});
