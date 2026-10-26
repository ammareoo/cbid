import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, SEED_EMAILS, sessions, setupContext, teardown, type Ctx } from '../helpers.js';

let ctx: Ctx;
let session: ReturnType<typeof sessions>;
beforeAll(async () => {
  ctx = await setupContext();
  session = sessions(ctx.app);
});
afterAll(async () => { await teardown(ctx); });

const student = async (k: keyof typeof SEED_EMAILS.students) => as(ctx.app, await session(SEED_EMAILS.students[k]));
const sana = async () => as(ctx.app, await session(SEED_EMAILS.teachers.sana));
const admin = async () => as(ctx.app, await session(SEED_EMAILS.admin));

describe('assignment submission', () => {
  it('accepts a submission, sets attempt and lateness server-side, and is idempotent per client token', async () => {
    const zara = await student('zara');
    const token = randomUUID();
    const url = `/api/assignments/${ctx.ids.assignments.barrierReport}/submissions`;
    const first = await zara.post(url, { body: 'My barrier report: the lift is out of service most weeks.', clientToken: token });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ attempt: 1, isLate: false });
    const repeat = await zara.post(url, { body: 'double click', clientToken: token });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().id).toBe(first.json().id);
  });

  it('rejects client-supplied attempt numbers and unknown fields', async () => {
    const zara = await student('zara');
    const res = await zara.post(`/api/assignments/${ctx.ids.assignments.barrierReport}/submissions`, { body: 'x', attempt: 99 });
    expect(res.statusCode).toBe(400);
  });

  it('enforces the maximum number of attempts', async () => {
    const danish = await student('danish');
    const url = `/api/assignments/${ctx.ids.assignments.barrierReport}/submissions`;
    for (let i = 0; i < 3; i++) expect((await danish.post(url, { body: `Draft ${i + 1}` })).statusCode).toBe(201);
    const fourth = await danish.post(url, { body: 'Draft 4' });
    expect(fourth.statusCode).toBe(422);
    expect(fourth.json().error.message).toMatch(/all 3 submission attempts/);
  });

  it('enforces the deadline on the server', async () => {
    const amina = await student('amina');
    const res = await amina.post(`/api/assignments/${ctx.ids.assignments.reflection}/submissions`, { body: 'Too late' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe('The submission deadline has passed');
  });

  it('rejects submissions from students who are not enrolled', async () => {
    const kamran = await student('kamran');
    const res = await kamran.post(`/api/assignments/${ctx.ids.assignments.barrierReport}/submissions`, { body: 'Not my course' });
    expect(res.statusCode).toBe(404);
  });

  it('marks submissions in the late window as late', async () => {
    await ctx.owner.query(`UPDATE assignments SET due_at = now() - interval '1 hour', late_until = now() + interval '1 day' WHERE id = $1`,
      [ctx.ids.assignments.barrierReport]);
    const fatima = await student('fatima');
    const res = await fatima.post(`/api/assignments/${ctx.ids.assignments.barrierReport}/submissions`, { body: 'Late but within the window' });
    expect(res.statusCode).toBe(201);
    expect(res.json().isLate).toBe(true);
  });
});

describe('grading and feedback', () => {
  it('lets the course teacher grade, guards concurrent edits, and releases to the student', async () => {
    const teacher = await sana();
    const url = `/api/assignments/${ctx.ids.assignments.barrierReport}/grades/${ctx.ids.students.zara}`;

    expect((await teacher.put(url, { score: 51 })).statusCode).toBe(422);

    const saved = await teacher.put(url, { score: 42, feedback: 'Clear and practical.' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ version: 1, releasedAt: null });

    const stale = await teacher.put(url, { score: 40, expectedVersion: 99 });
    expect(stale.statusCode).toBe(409);

    const zara = await student('zara');
    expect((await zara.get(`/api/assignments/${ctx.ids.assignments.barrierReport}`)).json().grade).toBeNull();

    const released = await teacher.put(url, { score: 44, feedback: 'Clear and practical. Good costing.', expectedVersion: 1, release: true });
    expect(released.json()).toMatchObject({ version: 2, newlyReleased: true });

    const view = (await zara.get(`/api/assignments/${ctx.ids.assignments.barrierReport}`)).json();
    expect(view.grade).toMatchObject({ score: 44, feedback: 'Clear and practical. Good costing.' });
    const notes = (await zara.get('/api/notifications')).json();
    expect(notes.items[0].title).toMatch(/Grade released/);
  });

  it('releases all pending grades for an assignment', async () => {
    const teacher = await sana();
    const res = await teacher.post(`/api/assignments/${ctx.ids.assignments.reflection}/grades/release`);
    expect(res.json().released).toBe(1); // Bilal's unreleased seed grade
    const bilal = await student('bilal');
    expect((await bilal.get(`/api/assignments/${ctx.ids.assignments.reflection}`)).json().grade.score).toBe(17);
  });

  it('shows the gradebook to staff only', async () => {
    const teacher = await sana();
    const book = (await teacher.get(`/api/courses/${ctx.ids.courses.det}/gradebook`)).json();
    expect(book.students.length).toBe(7);
    expect(book.assignments.map((a: { title: string }) => a.title)).toContain('Short barrier report');
  });
});

describe('quizzes', () => {
  it('runs a full attempt with server-side scoring and hidden answer keys', async () => {
    const omar = await student('omar');
    const quizView = (await omar.get(`/api/quizzes/${ctx.ids.quizzes.Q1}`)).json();
    expect(JSON.stringify(quizView)).not.toMatch(/correctOptionIds|acceptedAnswers/);
    expect(quizView).toMatchObject({ questionCount: 4, totalPoints: 5 });
    expect(quizView.questions).toBeUndefined();

    const start = await omar.post(`/api/quizzes/${ctx.ids.quizzes.Q1}/attempts`);
    expect(start.statusCode).toBe(201);
    const attemptId = start.json().id;
    const again = await omar.post(`/api/quizzes/${ctx.ids.quizzes.Q1}/attempts`);
    expect(again.json().id).toBe(attemptId); // resumes the open attempt

    const attempt = (await omar.get(`/api/attempts/${attemptId}`)).json();
    expect(JSON.stringify(attempt)).not.toMatch(/correctOptionIds|acceptedAnswers|is_correct/);
    const [q1, q2, q3, q4] = attempt.questions;
    const pick = (q: { options: { id: string; label: string }[] }, labels: string[]) =>
      q.options.filter((o) => labels.includes(o.label)).map((o) => o.id);

    const save = (q: { id: string }, body: unknown) => omar.put(`/api/attempts/${attemptId}/answers/${q.id}`, body);
    expect((await save(q1, { selectedOptionIds: pick(q1, ['Social model']) })).statusCode).toBe(200);
    expect((await save(q2, { selectedOptionIds: pick(q2, ['Videos without captions', 'Forms that only work with a mouse']) })).statusCode).toBe(200);
    expect((await save(q3, { textAnswer: ' crpd ' })).statusCode).toBe(200);
    expect((await save(q4, { selectedOptionIds: pick(q4, ['A favour granted at the manager\'s discretion']) })).statusCode).toBe(200);
    // single-choice question with two answers is rejected by the database rule
    expect((await save(q1, { selectedOptionIds: q1.options.map((o: { id: string }) => o.id) })).statusCode).toBe(422);
    // an option from another question is rejected
    expect((await save(q1, { selectedOptionIds: pick(q4, ['A change that lets a person with a disability take part on equal terms']) })).statusCode).toBe(422);

    const result = await omar.post(`/api/attempts/${attemptId}/submit`);
    expect(result.statusCode).toBe(200);
    // Q1 right (1), Q2 incomplete (0 of 2), Q3 right (1), Q4 wrong (0)
    expect(result.json()).toEqual({ score: 2, maxScore: 5 });

    expect((await save(q1, { selectedOptionIds: pick(q1, ['Medical model']) })).statusCode).toBe(422);
    expect((await omar.post(`/api/attempts/${attemptId}/submit`)).statusCode).toBe(409);
  });

  it('enforces the attempt limit', async () => {
    const omar = await student('omar');
    const second = await omar.post(`/api/quizzes/${ctx.ids.quizzes.Q1}/attempts`);
    expect(second.statusCode).toBe(201);
    await omar.post(`/api/attempts/${second.json().id}/submit`);
    const third = await omar.post(`/api/quizzes/${ctx.ids.quizzes.Q1}/attempts`);
    expect(third.statusCode).toBe(422);
  });

  it('does not let another student read an attempt', async () => {
    const omar = await student('omar');
    const attempts = (await omar.get(`/api/quizzes/${ctx.ids.quizzes.Q1}`)).json().attempts;
    const amina = await student('amina');
    expect((await amina.get(`/api/attempts/${attempts[0].id}`)).statusCode).toBe(404);
  });

  it('lets a teacher build a quiz but rejects invalid answer keys', async () => {
    const teacher = await sana();
    const base = { title: 'Pop quiz', opensAt: new Date().toISOString(), closesAt: new Date(Date.now() + 86_400_000).toISOString() };
    const bad = await teacher.post(`/api/courses/${ctx.ids.courses.det}/quizzes`, {
      ...base, questions: [{ kind: 'single', prompt: 'Pick one', points: 1, options: [{ label: 'A', correct: true }, { label: 'B', correct: true }] }],
    });
    expect(bad.statusCode).toBe(422);
    const good = await teacher.post(`/api/courses/${ctx.ids.courses.det}/quizzes`, {
      ...base, status: 'published', questions: [{ kind: 'short', prompt: 'Spell CRPD backwards', points: 1, acceptedAnswers: ['DPRC'] }],
    });
    expect(good.statusCode).toBe(201);
    const view = (await teacher.get(`/api/quizzes/${good.json().id}`)).json();
    expect(view.questions[0].acceptedAnswers).toEqual(['DPRC']);
  });
});

describe('enrolment', () => {
  it('lets a student self-enrol in an open course and enforces capacity', async () => {
    await ctx.owner.query('UPDATE courses SET capacity = 3 WHERE id = $1', [ctx.ids.courses.iet]); // 3 already enrolled
    const usman = await student('usman');
    const full = await usman.post(`/api/courses/${ctx.ids.courses.iet}/enroll`);
    expect(full.statusCode).toBe(409);
    expect(full.json().error.message).toBe('This course is full');

    await ctx.owner.query('UPDATE courses SET capacity = 10 WHERE id = $1', [ctx.ids.courses.iet]);
    expect((await usman.post(`/api/courses/${ctx.ids.courses.iet}/enroll`)).statusCode).toBe(201);
    expect((await usman.post(`/api/courses/${ctx.ids.courses.iet}/enroll`)).statusCode).toBe(201); // idempotent
    expect((await usman.get(`/api/courses/${ctx.ids.courses.iet}/modules`)).statusCode).toBe(200);
  });

  it('refuses self-enrolment when the course is closed', async () => {
    const usman = await student('usman');
    const res = await usman.post(`/api/courses/${ctx.ids.courses.ibt}/enroll`);
    expect(res.statusCode).toBe(201); // already enrolled in seed → returns existing
    const kamran = await student('kamran');
    expect((await kamran.post(`/api/courses/${ctx.ids.courses.ibt}/enroll`)).statusCode).toBe(422);
  });

  it('lets a student withdraw', async () => {
    const usman = await student('usman');
    expect((await usman.post(`/api/courses/${ctx.ids.courses.iet}/withdraw`)).json().status).toBe('dropped');
    expect((await usman.get(`/api/courses/${ctx.ids.courses.iet}/modules`)).statusCode).toBe(404);
  });
});

describe('administration', () => {
  it('creates a user with an invite instead of a password', async () => {
    const a = await admin();
    const res = await a.post('/api/admin/users', { email: 'new.teacher@cbid.example', fullName: 'Ayesha Rauf', role: 'teacher' });
    expect(res.statusCode).toBe(201);
    const { rows } = await ctx.owner.query('SELECT subject, body_text FROM email_outbox WHERE to_address = $1', ['new.teacher@cbid.example']);
    expect(rows[0].subject).toBe('Your CBID Institute account');
    expect(rows[0].body_text).toMatch(/reset-password\?token=/);
    expect((await a.post('/api/admin/users', { email: 'NEW.teacher@cbid.example', fullName: 'Dup', role: 'teacher' })).statusCode).toBe(409);
  });

  it('creates and publishes a course, assigns a teacher and enrols students', async () => {
    const a = await admin();
    const created = await a.post('/api/admin/courses', {
      code: 'DET250', title: 'Disability-Inclusive Public Services', termId: ctx.ids.terms.current, departmentId: ctx.ids.departments.systems,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await a.put(`/api/admin/courses/${id}/teachers/${ctx.ids.teachers.farhan}`, { isLead: true })).statusCode).toBe(200);
    expect((await a.put(`/api/admin/courses/${id}/teachers/${ctx.ids.students.amina}`, { isLead: false })).statusCode).toBe(422);
    const enrolled = await a.post(`/api/admin/courses/${id}/enrollments`, { userIds: [ctx.ids.students.kamran, ctx.ids.students.kamran, ctx.ids.teachers.sana] });
    expect(enrolled.statusCode).toBe(422); // a teacher cannot be enrolled as a student
    const ok = await a.post(`/api/admin/courses/${id}/enrollments`, { userIds: [ctx.ids.students.kamran] });
    expect(ok.json().results[0].status).toBe('enrolled');
    expect((await a.patch(`/api/admin/courses/${id}`, { status: 'published' })).statusCode).toBe(200);
    const kamran = await student('kamran');
    expect((await kamran.get(`/api/courses/${id}`)).json().relationship).toBe('learner');
  });

  it('refuses duplicate course codes within a term', async () => {
    const a = await admin();
    const dup = await a.post('/api/admin/courses', { code: 'DET101', title: 'Duplicate', termId: ctx.ids.terms.current });
    expect(dup.statusCode).toBe(409);
  });

  it('reports database-derived dashboard numbers', async () => {
    const a = await admin();
    const d = (await a.get('/api/admin/dashboard')).json();
    const { rows } = await ctx.owner.query("SELECT count(*)::int AS n FROM users WHERE role = 'student' AND status = 'active'");
    expect(d.counts.activeStudents).toBe(rows[0].n);
    const status = (await a.get('/api/admin/status')).json();
    expect(status.database.status).toBe('ok');
    expect(JSON.stringify(status)).not.toMatch(/password|secret|postgres:\/\//i);
  });

  it('paginates with bounded page sizes', async () => {
    const a = await admin();
    const page = (await a.get('/api/admin/users?pageSize=5&page=2')).json();
    expect(page.items).toHaveLength(5);
    expect(page.page).toBe(2);
    expect((await a.get('/api/admin/users?pageSize=500')).statusCode).toBe(400);
  });

  it('posts an institute-wide announcement that reaches every active user', async () => {
    const a = await admin();
    const res = await a.post('/api/announcements', { title: 'Campus closed on Friday', body: 'Exam centres will be closed for maintenance.' });
    expect(res.statusCode).toBe(201);
    const bilal = await student('bilal');
    const feed = (await bilal.get('/api/announcements')).json();
    expect(feed.items[0].title).toBe('Campus closed on Friday');
  });
});

describe('content and progress', () => {
  it('tracks completion and computes progress from records', async () => {
    const bilal = await student('bilal');
    const before = (await bilal.get(`/api/courses/${ctx.ids.courses.det}`)).json().progress;
    expect((await bilal.post(`/api/items/${ctx.ids.items.models}/complete`)).statusCode).toBe(200);
    const after = (await bilal.get(`/api/courses/${ctx.ids.courses.det}`)).json().progress;
    expect(after).toBeGreaterThan(before);
  });

  it('lets teachers add, reorder and publish content', async () => {
    const teacher = await sana();
    const mod = await teacher.post(`/api/courses/${ctx.ids.courses.det}/modules`, { title: 'Extra reading', published: true });
    expect(mod.statusCode).toBe(201);
    const item = await teacher.post(`/api/modules/${mod.json().id}/items`, { kind: 'link', title: 'WHO disability fact sheet', url: 'http://insecure.example', published: true });
    expect(item.statusCode).toBe(400); // https only
    const ok = await teacher.post(`/api/modules/${mod.json().id}/items`, { kind: 'page', title: 'Notes', body: '## Notes', published: true });
    expect(ok.statusCode).toBe(201);
    const move = await teacher.post(`/api/modules/${mod.json().id}/move`, { direction: 'up' });
    expect(move.json().moved).toBe(true);
  });
});
