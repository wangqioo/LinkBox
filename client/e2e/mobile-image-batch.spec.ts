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

test('mobile image batch hides ai analysis body in the feed', async ({ page }) => {
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
  await expect(gallery).not.toContainText(longSummary);
  await expect(gallery.locator('.batch-summary')).toHaveCount(0);

  await expect.poll(async () => gallery.locator('.batch-status').evaluate(
    element => getComputedStyle(element).getPropertyValue('-webkit-line-clamp'),
  )).toBe('1');
  await expect.poll(async () => gallery.locator('.batch-status').evaluate(
    element => getComputedStyle(element).fontSize,
  )).toBe('9px');
});

test('mobile image cards hide ai analysis in the feed but keep it in details', async ({ page }) => {
  const summary = '厨房台面上有一台咖啡机和几只杯子，这是图片详情页才应该完整展示的 AI 分析。';
  const files = [{
    id: '9401',
    original_filename: 'kitchen-counter.jpeg',
    filename: 'kitchen-counter.jpeg',
    type: 'image',
    file_size: 2048,
    batch_id: '',
    batch_index: 0,
    created_at: new Date().toISOString(),
    status: 'ready',
    processing: null,
    summary,
    description: summary,
  }];

  await page.route('**/api/mobile/files/stats', route => route.fulfill({
    json: {
      total: files.length,
      by_type: { image: files.length },
      by_status: { ready: files.length },
      recent_date: new Date().toISOString().slice(0, 10),
    },
  }));
  await page.route(/\/api\/mobile\/files\?/, route => route.fulfill({ json: files }));
  await page.route('**/api/mobile/files/9401', route => route.fulfill({ json: files[0] }));
  await page.route('**/api/mobile/files/9401/download', route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
  }));

  await registerMobileUser(page);

  const imageCard = page.locator('.fm-img-card');
  await expect(imageCard).toBeVisible();
  await expect(imageCard).not.toContainText(summary);
  await expect(imageCard.locator('.fm-summary-text')).toHaveCount(0);

  await imageCard.click();
  await expect(page.getByText('AI 简介')).toBeVisible();
  await expect(page.locator('.summary-text')).toContainText(summary);
});

test('mobile link cards keep ai hints visually secondary', async ({ page }) => {
  const files = [{
    id: '9301',
    original_filename: '不要一整段铺开 GitHub 开源项目 RuView 利用 WiFi 无线电波实现人体感知',
    filename: '不要一整段铺开 GitHub 开源项目 RuView 利用 WiFi 无线电波实现人体感知',
    type: 'link',
    url: 'https://mp.weixin.qq.com/s/example',
    favicon_url: '',
    og_image: '',
    file_size: null,
    batch_id: '',
    batch_index: 0,
    created_at: new Date().toISOString(),
    status: 'ready',
    processing: null,
    summary: 'GitHub开源项目RuView利用WiFi无线电波实现人体感知，无需摄像头，可检测人员存在、心率呼吸、跌倒预警，适用于居家养老、安防等领域。这段内容在首页不应该完整铺开。',
  }];

  await page.route('**/api/mobile/files/stats', route => route.fulfill({
    json: {
      total: files.length,
      by_type: { link: files.length },
      by_status: { ready: files.length },
      recent_date: new Date().toISOString().slice(0, 10),
    },
  }));
  await page.route(/\/api\/mobile\/files\?/, route => route.fulfill({ json: files }));

  await registerMobileUser(page);

  const linkCard = page.locator('.fm-link-card');
  await expect(linkCard).toBeVisible();
  await expect.poll(async () => page.locator('.organizer-strip').evaluate((organizer) => {
    const organizerRect = organizer.getBoundingClientRect();
    const card = document.querySelector('.fm-link-card');
    if (!card) return -1;
    const cardRect = card.getBoundingClientRect();
    return Math.round(cardRect.top - organizerRect.bottom);
  })).toBeGreaterThanOrEqual(10);

  const summary = linkCard.locator('.fm-link-summary');
  await expect(summary).toBeVisible();

  await expect.poll(async () => summary.evaluate(
    element => getComputedStyle(element).fontSize,
  )).toBe('9px');
  await expect.poll(async () => summary.evaluate(
    element => getComputedStyle(element).getPropertyValue('-webkit-line-clamp'),
  )).toBe('1');
  await expect.poll(async () => summary.evaluate(
    element => element.getBoundingClientRect().height,
  )).toBeLessThan(14);
});

test('desktop phone shell keeps the header below the status island', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:5175/mobile/',
    viewport: { width: 928, height: 1792 },
    isMobile: false,
    hasTouch: false,
  });
  const page = await context.newPage();

  try {
    await registerMobileUser(page);

    await expect(page.locator('.di')).toBeVisible();
    await expect(page.locator('.fm-ttl')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const island = document.querySelector('.di')?.getBoundingClientRect();
      const title = document.querySelector('.fm-ttl')?.getBoundingClientRect();
      if (!island || !title) return -1;
      return Math.round(title.top - island.bottom);
    })).toBeGreaterThanOrEqual(18);
  } finally {
    await context.close();
  }
});
