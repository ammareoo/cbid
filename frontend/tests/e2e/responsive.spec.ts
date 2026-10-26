import { expect, test } from '@playwright/test';
import { signIn, USERS } from './helpers';

test('mobile navigation works through the menu drawer without horizontal scrolling', async ({ page }) => {
  await signIn(page, USERS.student);
  await expect(page.getByRole('heading', { level: 1, name: /Amina/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Main menu' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();
  await expect(drawer).toBeHidden();
});

test('keyboard users can skip to the main content', async ({ page }) => {
  await signIn(page, USERS.student);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /Amina/ })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('display settings enlarge text and persist', async ({ page }) => {
  await signIn(page, USERS.student);
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('radio', { name: 'Larger' }).check();
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('125%');
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('125%');
});
