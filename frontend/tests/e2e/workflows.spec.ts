import { expect, test } from '@playwright/test';
import { signIn, signOut, USERS } from './helpers';

// These scenarios share one seeded database and run in order.
test.describe.configure({ mode: 'serial' });

test('learner opens a course, reads content and submits an assignment', async ({ page }) => {
  await signIn(page, USERS.student);
  await expect(page.getByRole('heading', { level: 1, name: /Amina/ })).toBeVisible();

  await page.getByRole('link', { name: 'Disability Equality Training' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Disability Equality Training' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Content' }).click();
  await page.getByRole('link', { name: 'Spot barriers in your own workplace' }).click();
  await page.getByRole('button', { name: 'Mark as complete' }).click();
  await expect(page.getByText('You have completed this item.')).toBeVisible();

  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Assignments' }).click();
  await page.getByRole('link', { name: 'Short barrier report' }).click();
  await page.getByLabel('Written response').fill('The lift at our office is out of service most weeks. A maintenance contract with a 24-hour fix time would remove the barrier.');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your work has been submitted' })).toBeVisible();
  await expect(page.getByText('Attempt 1', { exact: true })).toBeVisible();
  await expect(page.getByText('2 of 3 attempts left')).toBeVisible();
  await signOut(page);
});

test('trainer grades the submission and releases feedback', async ({ page }) => {
  await signIn(page, USERS.teacher);
  const row = page.getByRole('row', { name: /Amina Khan.*Short barrier report/ });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: /Grade/ }).click();

  await expect(page.getByRole('heading', { name: 'Amina Khan', level: 3 })).toBeVisible();
  await expect(page.getByText(/lift at our office/)).toBeVisible();
  await page.getByLabel('Score out of 50').fill('51');
  await page.getByRole('button', { name: 'Save grade' }).click();
  await expect(page.getByText('Enter a score from 0 to 50')).toBeVisible();

  await page.getByLabel('Score out of 50').fill('44');
  await page.getByLabel('Feedback for the learner').fill('Clear barrier and a practical fix. Add who approves the budget.');
  await page.getByLabel(/Release to the learner/).check();
  await page.getByRole('button', { name: 'Save grade' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grade saved and released' })).toBeVisible();
  await signOut(page);
});

test('learner sees the released grade and a notification', async ({ page }) => {
  await signIn(page, USERS.student);
  await page.getByRole('link', { name: /Notifications, \d+ unread/ }).click();
  await page.getByRole('link', { name: 'Grade released: Short barrier report' }).click();
  await expect(page.getByText('Clear barrier and a practical fix. Add who approves the budget.')).toBeVisible();
  await expect(page.getByText('/ 50 (88%)')).toBeVisible();
  await signOut(page);
});

test('learner takes a timed quiz that is scored on the server', async ({ page }) => {
  await signIn(page, USERS.student2);
  await page.getByRole('link', { name: 'Disability Equality Training' }).first().click();
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Quizzes' }).click();
  await page.getByRole('link', { name: 'Week 1–2 check: key terms' }).click();
  await expect(page.getByText('4 (5 points)')).toBeVisible();
  await page.getByRole('button', { name: 'Start attempt 1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start now' }).click();

  await expect(page).toHaveURL(/\/attempts\//);
  await page.getByRole('radio', { name: 'Social model' }).check();
  await page.getByRole('checkbox', { name: 'Videos without captions' }).check();
  await page.getByRole('checkbox', { name: 'Forms that only work with a mouse' }).check();
  await page.getByRole('checkbox', { name: 'Information only in complex language' }).check();
  await page.getByLabel('Your answer').fill('crpd');
  await page.getByRole('radio', { name: 'A change that lets a person with a disability take part on equal terms' }).check();
  await expect(page.getByText(/4 of 4 answered · all changes saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit quiz' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Score: 5 out of 5.')).toBeVisible();
  await expect(page.getByText(/Correct · 2 points/)).toBeVisible();
  await signOut(page);
});

test('administrator creates a person, creates and publishes a course', async ({ page }) => {
  await signIn(page, USERS.admin);
  await expect(page.getByRole('heading', { name: 'Institute overview' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'People' }).click();
  await page.getByRole('button', { name: 'Add a person' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('Ayesha Rauf');
  await dialog.getByLabel('Email address').fill('ayesha.rauf@cbid.example');
  await dialog.getByLabel('Role').selectOption('teacher');
  await dialog.getByRole('button', { name: 'Create and send invitation' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ayesha Rauf' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Courses' }).click();
  await page.getByRole('button', { name: 'Create course' }).click();
  const c = page.getByRole('dialog');
  await c.getByLabel('Course code').fill('DET260');
  await c.getByLabel('Term').selectOption({ index: 1 });
  await c.getByLabel('Title').fill('Inclusive Emergency Preparedness');
  await c.getByRole('button', { name: 'Create course' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Inclusive Emergency Preparedness' })).toBeVisible();

  await page.getByLabel('Assign a trainer').fill('Ayesha');
  await page.getByRole('button', { name: 'Add Ayesha Rauf' }).click();
  await expect(page.getByText('Ayesha Rauf assigned')).toBeVisible();
  await page.getByRole('button', { name: 'Publish course' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Course updated')).toBeVisible();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Audit log' }).first().click();
  await expect(page.getByText('Published course').first()).toBeVisible();
  await signOut(page);
});

test('trainer issues a certificate that the learner can print and anyone can verify', async ({ page, browser }) => {
  await signIn(page, USERS.teacher);
  await page.getByRole('link', { name: 'Disability Equality Training' }).first().click();
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Certificates' }).click();
  await page.getByRole('button', { name: 'Issue certificate to Amina Khan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue certificate' }).click();
  const toast = page.getByRole('status').filter({ hasText: /Certificate CBID-\d{4}-[A-Z2-9]{8} issued to Amina Khan/ });
  await expect(toast).toBeVisible();
  const serial = (await toast.textContent())!.match(/CBID-\d{4}-[A-Z2-9]{8}/)![0];
  await signOut(page);

  await signIn(page, USERS.student);
  await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Certificates' }).click();
  await page.getByRole('link', { name: 'View and print certificate for Disability Equality Training' }).click();
  const cert = page.getByRole('article', { name: 'Certificate of completion for Amina Khan' });
  await expect(cert).toContainText('DET101 · Disability Equality Training');
  await expect(cert).toContainText(serial);
  await signOut(page);

  // A signed-out visitor (e.g. an employer) checks the serial.
  const visitor = await browser.newPage();
  await visitor.goto('/login');
  await visitor.getByRole('link', { name: 'Verify a certificate' }).click();
  await visitor.getByLabel('Serial number').fill(serial.toLowerCase());
  await visitor.getByRole('button', { name: 'Check certificate' }).click();
  await expect(visitor.getByText('Valid certificate')).toBeVisible();
  await expect(visitor.getByText('DET101 · Disability Equality Training')).toBeVisible();
  await visitor.close();
});
