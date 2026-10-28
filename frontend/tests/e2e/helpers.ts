import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'CbidDemo!2026';
export const USERS = {
  student: 'amina.khan@cbid.example',
  student2: 'zara.malik@cbid.example',
  teacher: 'sana.mirza@cbid.example',
  admin: 'coordinator@cbid.example',
};

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: /Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}
