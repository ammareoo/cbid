import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, USERS } from './helpers';

/** Automated WCAG 2.2 A/AA checks with axe-core. Automated checks catch roughly a third of issues;
 *  they complement, not replace, manual screen-reader and keyboard testing. */
async function audit(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.help}`)).toEqual([]);
}

test('sign-in and certificate verification pages have no serious accessibility violations', async ({ page }) => {
  await page.goto('/login');
  await audit(page, 'login');
  await page.goto('/verify');
  await audit(page, 'verify');
});

test('learner pages have no serious accessibility violations', async ({ page }) => {
  await signIn(page, USERS.student);
  await audit(page, 'dashboard');
  await page.getByRole('link', { name: 'Disability Equality Training' }).first().click();
  await audit(page, 'course overview');
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Content' }).click();
  await audit(page, 'modules');
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Assignments' }).click();
  await audit(page, 'assignments');
  await page.goto('/calendar');
  await audit(page, 'calendar');
  await page.goto('/grades');
  await audit(page, 'grades');
  await page.goto('/catalogue');
  await audit(page, 'catalogue');
  await page.goto('/certificates');
  await audit(page, 'certificates');
  await page.getByRole('link', { name: /View and print certificate/ }).first().click();
  await audit(page, 'certificate');
});

test('trainer and administrator pages have no serious accessibility violations', async ({ page }) => {
  await signIn(page, USERS.teacher);
  await audit(page, 'teacher dashboard');
  await page.getByRole('link', { name: 'Disability Equality Training' }).first().click();
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Gradebook' }).click();
  await audit(page, 'gradebook');
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Certificates' }).click();
  await audit(page, 'course certificates');
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await signIn(page, USERS.admin);
  await audit(page, 'admin overview');
  await page.goto('/admin/users');
  await audit(page, 'admin users');
  await page.goto('/admin/audit');
  await audit(page, 'audit log');
  await page.goto('/admin/settings');
  await audit(page, 'settings');
});
