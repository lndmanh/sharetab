import { test, expect } from '@playwright/test';
import { users, login } from './helpers';

test.describe('i18n Language Switching', () => {
  test('switch from English to Vietnamese and back on login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Welcome back')).toBeVisible();

    await page.getByTestId('language-switcher').first().click();
    await expect(page.getByRole('menuitem', { name: '🇻🇳 Tiếng Việt' })).toBeVisible();
    await page.getByRole('menuitem', { name: '🇻🇳 Tiếng Việt' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await expect(page.getByText('Chào mừng trở lại')).toBeVisible();
    await expect(page.getByText('Đăng nhập vào tài khoản ShareTab của bạn')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Mật khẩu')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();

    // Switch back to English
    await page.getByTestId('language-switcher').first().click();
    await expect(page.getByRole('menuitem', { name: '🇺🇸 English' })).toBeVisible();
    await page.getByRole('menuitem', { name: '🇺🇸 English' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Verify English restored
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('switch from English to Vietnamese and back on register page', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText('Create your account')).toBeVisible();

    await page.getByTestId('language-switcher').first().click();
    await expect(page.getByRole('menuitem', { name: '🇻🇳 Tiếng Việt' })).toBeVisible();
    await page.getByRole('menuitem', { name: '🇻🇳 Tiếng Việt' }).click();
    await expect(page).toHaveURL(/\/register$/);

    await expect(page.getByText('Tạo tài khoản')).toBeVisible();
    await expect(page.getByText('Bắt đầu chia sẻ chi tiêu với bạn bè')).toBeVisible();
    await expect(page.getByLabel('Tên')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tạo tài khoản' })).toBeVisible();

    // Switch back to English
    await page.getByTestId('language-switcher').first().click();
    await expect(page.getByRole('menuitem', { name: '🇺🇸 English' })).toBeVisible();
    await page.getByRole('menuitem', { name: '🇺🇸 English' }).click();
    await expect(page).toHaveURL(/\/register$/);

    await expect(page.getByText('Create your account')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  });

  test('switch language on authenticated dashboard page', async ({ page }) => {
    // Use desktop viewport so sidebar language switcher is directly accessible
    await page.setViewportSize({ width: 1280, height: 720 });
    await login(page, users.alice.email, users.alice.password);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Click sidebar language switcher
    await page.getByTestId('language-switcher').first().click();
    await expect(page.getByRole('menuitem', { name: '🇻🇳 Tiếng Việt' })).toBeVisible();
    await page.getByRole('menuitem', { name: '🇻🇳 Tiếng Việt' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await expect(page.getByRole('heading', { name: 'Bảng điều khiển' })).toBeVisible();
    await expect(page.getByText('Bạn được nhận').first()).toBeVisible();
    await expect(page.getByText('Bạn nợ').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nhóm' })).toBeVisible();

    // Switch back to English
    await page.getByTestId('language-switcher').first().click();
    await expect(page.getByRole('menuitem', { name: '🇺🇸 English' })).toBeVisible();
    await page.getByRole('menuitem', { name: '🇺🇸 English' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Verify English restored
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('You are owed').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
  });

  test('navigation links stay unprefixed', async ({ page }) => {
    await page.context().addCookies([
      { name: 'NEXT_LOCALE', value: 'vi', url: 'http://localhost:3001' },
    ]);
    await page.goto('/login');
    await expect(page.getByText('Chào mừng trở lại')).toBeVisible();

    const createLink = page.getByRole('link', { name: 'Tạo tài khoản' });
    await expect(createLink).toHaveAttribute('href', '/register');

    const splitLink = page.getByRole('link', { name: 'Chia hóa đơn không cần tài khoản' });
    await expect(splitLink).toHaveAttribute('href', '/split');
  });

  test('root URL redirects to dashboard without a locale prefix', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
