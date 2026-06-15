import { expect, type Page } from '@playwright/test';

export const PLAYWRIGHT_ADMIN = {
  username: 'playwright-admin',
  password: 'pass1234',
};

export async function registerViaUi(page: Page, username = `pw-${Date.now()}`) {
  await page.goto('/');
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByPlaceholder('用户名').fill(username);
  await page.getByPlaceholder('密码').fill('pass1234');
  await page.getByRole('button', { name: '注册' }).click();

  await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible();

  return { username, password: 'pass1234' };
}

export async function loginViaUi(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByPlaceholder('用户名').fill(username);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible();
}

export async function loginAsAdminViaUi(page: Page) {
  await loginViaUi(page, PLAYWRIGHT_ADMIN.username, PLAYWRIGHT_ADMIN.password);
  await expect(page.getByRole('link', { name: /系统设置/ })).toBeVisible();
}
