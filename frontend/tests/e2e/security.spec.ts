import { expect, test } from '@playwright/test';
import { signIn, USERS } from './helpers';

test('a learner is redirected away from administrator pages', async ({ page }) => {
  await signIn(page, USERS.student);
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('the API refuses privileged calls even when made from a learner session', async ({ page }) => {
  await signIn(page, USERS.student);
  const session = await page.evaluate(() => fetch('/api/auth/session').then((r) => r.json()));
  const results = await page.evaluate(async (csrf) => {
    const call = (method: string, url: string, body?: unknown) =>
      fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.status);
    return {
      users: await call('GET', '/api/admin/users'),
      promote: await call('PATCH', `/api/me/profile`, { role: 'admin' }),
      createCourse: await call('POST', '/api/admin/courses', { code: 'XX101', title: 'Nope', termId: '00000000-0000-0000-0000-000000000000' }),
    };
  }, session.csrfToken);
  expect(results).toEqual({ users: 403, promote: 400, createCourse: 403 });
});

test('requests without the CSRF token are rejected', async ({ page }) => {
  await signIn(page, USERS.student);
  const status = await page.evaluate(() => fetch('/api/notifications/read-all', { method: 'POST' }).then((r) => r.status));
  expect(status).toBe(403);
});

test('a learner cannot open a course they are not enrolled in', async ({ page, request }) => {
  await signIn(page, USERS.student2);
  // Find a course id Zara is not in by asking the catalogue (IBT201 is closed to self-enrolment).
  const cat = await page.evaluate(() => fetch('/api/courses?scope=catalogue&search=IBT201').then((r) => r.json()));
  const id = cat.items[0].id;
  await page.goto(`/courses/${id}/modules`);
  await expect(page.getByText(/You are viewing the public outline|not found/i).first()).toBeVisible();
  const status = await page.evaluate((cid) => fetch(`/api/courses/${cid}/modules`).then((r) => r.status), id);
  expect(status).toBe(404);
  void request;
});

test('signed-out visitors cannot reach private pages or data', async ({ page }) => {
  await page.goto('/grades');
  await expect(page).toHaveURL(/\/login/);
  const status = await page.evaluate(() => fetch('/api/me/dashboard').then((r) => r.status));
  expect(status).toBe(401);
});

test('responses carry a strict content security policy', async ({ page }) => {
  const res = await page.goto('/login');
  const csp = res!.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
});
