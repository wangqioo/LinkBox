import { expect, test } from '@playwright/test';
import { loginAsAdminViaUi } from './helpers/auth';

test('admin can retry a failed background job from settings', async ({ page }) => {
  await loginAsAdminViaUi(page);

  await page.getByRole('link', { name: /系统设置/ }).click();

  await expect(page.getByRole('heading', { name: '后台任务' })).toBeVisible();
  const failedJob = page.getByText('#9001 生成网页摘要');
  await expect(failedJob).toBeVisible();
  await expect(page.getByText(/link\.summarize · 尝试 3\/3/)).toBeVisible();
  await expect(page.getByText('Playwright seeded failed job')).toBeVisible();
  await expect(page.getByText(/建议：检查 AI 服务地址、模型和 API Key 是否可用后重试。/)).toBeVisible();

  await page
    .locator('div')
    .filter({ has: failedJob })
    .getByRole('button', { name: '重试', exact: true })
    .click();

  await expect(failedJob).toBeHidden();
  await expect(page.getByRole('main').getByText('已重新入队任务 #9001')).toBeVisible();
});
