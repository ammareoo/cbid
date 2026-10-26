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
const teacher = async (k: keyof typeof SEED_EMAILS.teachers) => as(ctx.app, await session(SEED_EMAILS.teachers[k]));
const admin = async () => as(ctx.app, await session(SEED_EMAILS.admin));

describe('students cannot reach other people\'s data (IDOR/BOLA)', () => {
  it('cannot read another student\'s submissions or the grading queue', async () => {
    const { assignments, students } = ctx.ids;
    const zara = await student('zara');
    expect((await zara.get(`/api/assignments/${assignments.reflection}/submissions`)).statusCode).toBe(403);
    expect((await zara.get(`/api/assignments/${assignments.reflection}/submissions/${students.amina}`)).statusCode).toBe(403);
    const mine = (await zara.get(`/api/assignments/${assignments.reflection}`)).json();
    expect(mine.submissions).toEqual([]);
  });

  it('cannot see an unreleased grade, even their own', async () => {
    const bilal = await student('bilal');
    const res = (await bilal.get(`/api/assignments/${ctx.ids.assignments.reflection}`)).json();
    expect(res.submissions).toHaveLength(1);
    expect(res.grade).toBeNull();
    const amina = (await (await student('amina')).get(`/api/assignments/${ctx.ids.assignments.reflection}`)).json();
    expect(amina.grade.score).toBe(18);
  });

  it('cannot grade, even by crafting a request', async () => {
    const amina = await student('amina');
    const res = await amina.put(`/api/assignments/${ctx.ids.assignments.reflection}/grades/${ctx.ids.students.amina}`, { score: 20 });
    expect(res.statusCode).toBe(403);
    const { rows } = await ctx.owner.query('SELECT score FROM grades WHERE assignment_id = $1 AND student_id = $2',
      [ctx.ids.assignments.reflection, ctx.ids.students.amina]);
    expect(rows[0].score).toBe(18);
  });

  it('cannot open courses they are not enrolled in, or draft courses', async () => {
    const zara = await student('zara');
    expect((await zara.get(`/api/courses/${ctx.ids.courses.ibt}/modules`)).statusCode).toBe(404);
    expect((await zara.get(`/api/courses/${ctx.ids.courses.cbw}`)).statusCode).toBe(404);
    expect((await zara.get(`/api/assignments/${ctx.ids.assignments.advert}`)).statusCode).toBe(404);
  });

  it('cannot see draft assignments or unpublished modules', async () => {
    const amina = await student('amina');
    expect((await amina.get(`/api/assignments/${ctx.ids.assignments.draftWork}`)).statusCode).toBe(404);
    const list = (await amina.get(`/api/courses/${ctx.ids.courses.det}/assignments`)).json();
    expect(list.items.map((a: { title: string }) => a.title)).not.toContain('Final reflection (draft)');
    const mods = (await amina.get(`/api/courses/${ctx.ids.courses.det}/modules`)).json();
    expect(mods.modules.map((m: { title: string }) => m.title)).not.toContain('Week 4 · Measuring progress');
    expect((await amina.get(`/api/items/${ctx.ids.items.measuring}`)).statusCode).toBe(404);
  });

  it('cannot see the course roster or other students\' profiles', async () => {
    const amina = await student('amina');
    expect((await amina.get(`/api/courses/${ctx.ids.courses.det}/students`)).statusCode).toBe(403);
    expect((await amina.get(`/api/courses/${ctx.ids.courses.det}/gradebook`)).statusCode).toBe(403);
  });

  it('cannot use admin endpoints', async () => {
    const amina = await student('amina');
    for (const url of ['/api/admin/dashboard', '/api/admin/users', '/api/admin/audit', '/api/admin/settings']) {
      expect((await amina.get(url)).statusCode).toBe(403);
    }
  });

  it('ignores mass-assignment attempts on their profile', async () => {
    const amina = await student('amina');
    expect((await amina.patch('/api/me/profile', { role: 'admin' })).statusCode).toBe(400);
    expect((await amina.patch('/api/me/profile', { fullName: 'Amina K.', status: 'active' })).statusCode).toBe(400);
    const ok = await amina.patch('/api/me/profile', { preferredName: 'Amina' });
    expect(ok.statusCode).toBe(200);
    const { rows } = await ctx.owner.query('SELECT role FROM users WHERE id = $1', [ctx.ids.students.amina]);
    expect(rows[0].role).toBe('student');
  });
});

describe('teachers are limited to the courses they teach', () => {
  it('cannot view or grade submissions in another teacher\'s course', async () => {
    const farhan = await teacher('farhan');
    expect((await farhan.get(`/api/assignments/${ctx.ids.assignments.reflection}/submissions`)).statusCode).toBe(404);
    const res = await farhan.put(`/api/assignments/${ctx.ids.assignments.reflection}/grades/${ctx.ids.students.amina}`, { score: 1 });
    expect(res.statusCode).toBe(404);
    expect((await farhan.get(`/api/courses/${ctx.ids.courses.det}/students`)).statusCode).toBe(404);
  });

  it('can see their own roster with progress derived from records', async () => {
    const sana = await teacher('sana');
    const res = await sana.get(`/api/courses/${ctx.ids.courses.det}/students`);
    expect(res.statusCode).toBe(200);
    const amina = res.json().items.find((s: { fullName: string }) => s.fullName === 'Amina Khan');
    expect(amina.progress).toBe(50); // 3 of 6 published items completed in the seed
  });

  it('cannot publish, archive or re-code a course, or create one', async () => {
    const sana = await teacher('sana');
    expect((await sana.patch(`/api/courses/${ctx.ids.courses.det}`, { status: 'archived' })).statusCode).toBe(400);
    expect((await sana.patch(`/api/admin/courses/${ctx.ids.courses.det}`, { status: 'archived' })).statusCode).toBe(403);
    expect((await sana.post('/api/admin/courses', { code: 'DET999', title: 'Rogue course', termId: ctx.ids.terms.current })).statusCode).toBe(403);
    expect((await sana.patch(`/api/courses/${ctx.ids.courses.det}`, { title: 'Disability Equality Training' })).statusCode).toBe(200);
  });

  it('cannot post institute-wide announcements or manage users', async () => {
    const sana = await teacher('sana');
    expect((await sana.post('/api/announcements', { title: 'Hello all', body: 'x' })).statusCode).toBe(403);
    expect((await sana.post('/api/admin/users', { email: 'x@cbid.example', fullName: 'X', role: 'teacher' })).statusCode).toBe(403);
  });

  it('cannot edit an archived course', async () => {
    const sana = await teacher('sana');
    const res = await sana.post(`/api/courses/${ctx.ids.courses.awareness}/modules`, { title: 'New module' });
    expect(res.statusCode).toBe(403);
  });
});

describe('administrator privilege boundaries', () => {
  it('cannot grant the administrator role or change their own account', async () => {
    const a = await admin();
    expect((await a.patch(`/api/admin/users/${ctx.ids.students.omar}`, { role: 'admin' })).statusCode).toBe(400);
    expect((await a.patch(`/api/admin/users/${ctx.ids.admin}`, { status: 'deactivated' })).statusCode).toBe(403);
    expect((await a.post('/api/admin/users', { email: 'boss@cbid.example', fullName: 'Boss', role: 'admin' })).statusCode).toBe(400);
  });

  it('records privileged changes in the audit log', async () => {
    const a = await admin();
    const res = await a.patch(`/api/admin/users/${ctx.ids.students.kamran}`, { fullName: 'Kamran Javed' });
    expect(res.statusCode).toBe(200);
    const audit = (await a.get('/api/admin/audit?action=user.')).json();
    expect(audit.items[0]).toMatchObject({ action: 'user.updated', entityId: ctx.ids.students.kamran, actorName: 'Nadia Hussain' });
  });

  it('deactivating a user revokes their sessions immediately', async () => {
    const victimSession = await session(SEED_EMAILS.students.sadia);
    expect((await as(ctx.app, victimSession).get('/api/me/dashboard')).statusCode).toBe(200);
    const a = await admin();
    expect((await a.patch(`/api/admin/users/${ctx.ids.students.sadia}`, { status: 'deactivated' })).statusCode).toBe(200);
    expect((await as(ctx.app, victimSession).get('/api/me/dashboard')).statusCode).toBe(401);
  });

  it('rejects malformed ids without leaking internals', async () => {
    const a = await admin();
    const res = await a.get('/api/admin/users/not-a-uuid');
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/postgres|SELECT|stack/i);
  });
});
