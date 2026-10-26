import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asDbUser, SEED_EMAILS, sessions, setupContext, teardown, type Ctx } from '../helpers.js';

let ctx: Ctx;
let session: ReturnType<typeof sessions>;
beforeAll(async () => {
  ctx = await setupContext();
  session = sessions(ctx.app);
});
afterAll(async () => { await teardown(ctx); });

const learner = async (k: keyof typeof SEED_EMAILS.students) => as(ctx.app, await session(SEED_EMAILS.students[k]));
const trainer = async (k: keyof typeof SEED_EMAILS.teachers) => as(ctx.app, await session(SEED_EMAILS.teachers[k]));
const admin = async () => as(ctx.app, await session(SEED_EMAILS.admin));
const SERIAL = /^CBID-\d{4}-[A-HJ-NP-Z2-9]{8}$/;

describe('issuing certificates', () => {
  it('lets the course trainer issue one certificate to an enrolled learner, notifying them', async () => {
    const sana = await trainer('sana');
    const { courses, students } = ctx.ids;
    const res = await sana.post(`/api/courses/${courses.det}/certificates`, { userId: students.hira });
    expect(res.statusCode).toBe(201);
    expect(res.json().serial).toMatch(SERIAL);

    const again = await sana.post(`/api/courses/${courses.det}/certificates`, { userId: students.hira });
    expect(again.statusCode).toBe(409);

    const { rows: notes } = await ctx.owner.query(
      "SELECT title, link FROM notifications WHERE user_id = $1 AND kind = 'certificate'", [students.hira]);
    expect(notes[0].title).toBe('Certificate issued: Disability Equality Training');
    expect(notes[0].link).toBe(`/certificates/${res.json().id}`);
    const { rows: mail } = await ctx.owner.query(
      "SELECT body_text FROM email_outbox WHERE to_address = $1 AND subject = 'Certificate issued: Disability Equality Training'", [SEED_EMAILS.students.hira]);
    expect(mail[0].body_text).toContain(`CBID Institute has issued your certificate for DET101 Disability Equality Training.`);
    expect(mail[0].body_text).toContain(res.json().serial);
    const { rows: audit } = await ctx.owner.query("SELECT 1 FROM audit_logs WHERE action = 'certificate.issued' AND entity_id = $1", [res.json().id]);
    expect(audit).toHaveLength(1);
  });

  it('refuses learners, other courses\' trainers, people not enrolled and draft courses', async () => {
    const { courses, students } = ctx.ids;
    const amina = await learner('amina');
    expect((await amina.post(`/api/courses/${courses.det}/certificates`, { userId: students.amina })).statusCode).toBe(403);

    const farhan = await trainer('farhan'); // teaches IBT201, not DET101
    expect((await farhan.post(`/api/courses/${courses.det}/certificates`, { userId: students.bilal })).statusCode).toBe(404);

    const sana = await trainer('sana');
    expect((await sana.post(`/api/courses/${courses.det}/certificates`, { userId: students.kamran })).statusCode).toBe(422);

    const a = await admin();
    const draft = await a.post(`/api/courses/${courses.cbw}/certificates`, { userId: students.amina });
    expect(draft.statusCode).toBe(422);
  });

  it('cannot be written directly by the API role, only through the trusted functions', async () => {
    const { courses, students, teachers } = ctx.ids;
    await expect(asDbUser(ctx.appPool, teachers.sana,
      `INSERT INTO certificates (serial, course_id, user_id, recipient_name, course_code, course_title, issued_by)
       VALUES ('CBID-2026-AAAAAAAA', $1, $2, 'X', 'DET101', 'X', $3)`, [courses.det, students.bilal, teachers.sana]))
      .rejects.toThrow(/permission denied/);
    await expect(asDbUser(ctx.appPool, students.amina, "UPDATE certificates SET recipient_name = 'Someone else'"))
      .rejects.toThrow(/permission denied/);
  });
});

describe('viewing certificates', () => {
  it('shows learners only their own certificates', async () => {
    const amina = await learner('amina');
    const mine = await amina.get('/api/certificates');
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items.map((c: { courseCode: string }) => c.courseCode)).toEqual(['DET090']);

    const hiraCert = (await ctx.owner.query('SELECT id FROM certificates WHERE user_id = $1', [ctx.ids.students.hira])).rows[0].id;
    expect((await amina.get(`/api/certificates/${hiraCert}`)).statusCode).toBe(404);
    const hira = await learner('hira');
    const own = await hira.get(`/api/certificates/${hiraCert}`);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ recipientName: 'Hira Siddiqui', courseCode: 'DET101', branding: { institute_name: 'CBID Institute' } });
  });

  it('gives course staff the learner list with certificate status', async () => {
    const sana = await trainer('sana');
    const res = await sana.get(`/api/courses/${ctx.ids.courses.det}/certificates`);
    expect(res.statusCode).toBe(200);
    const hira = res.json().learners.find((l: { fullName: string }) => l.fullName === 'Hira Siddiqui');
    expect(hira.certificateSerial).toMatch(SERIAL);
    expect((await (await learner('amina')).get(`/api/courses/${ctx.ids.courses.det}/certificates`)).statusCode).toBe(403);
  });
});

describe('public verification and revocation', () => {
  it('verifies a serial without signing in and reveals no identifiers', async () => {
    const serial = ctx.ids.certificates.awarded.serial;
    const res = await as(ctx.app, null).get(`/api/verify/${serial.toLowerCase()}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ serial, recipientName: 'Amina Khan', courseCode: 'DET090', valid: true, issuer: 'CBID Institute' });
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['id', 'userId', 'courseId', 'email', 'revokeReason']));

    expect((await as(ctx.app, null).get('/api/verify/CBID-2026-ZZZZZZZZ')).statusCode).toBe(404);
    expect((await as(ctx.app, null).get('/api/verify/not-a-serial')).statusCode).toBe(400);
  });

  it('lets staff revoke with a reason; verification then reports it as not valid', async () => {
    const sana = await trainer('sana');
    const { id, serial } = ctx.ids.certificates.awarded;
    expect((await sana.post(`/api/certificates/${id}/revoke`, { reason: '' })).statusCode).toBe(400);
    const res = await sana.post(`/api/certificates/${id}/revoke`, { reason: 'Issued in error' });
    expect(res.statusCode).toBe(200);
    expect((await sana.post(`/api/certificates/${id}/revoke`, { reason: 'Again' })).statusCode).toBe(409);

    const v = (await as(ctx.app, null).get(`/api/verify/${serial}`)).json();
    expect(v.valid).toBe(false);
    expect(v.revokedAt).toBeTruthy();
    expect(v.revokeReason).toBeUndefined();

    // Another course's trainer cannot revoke (and cannot tell that the certificate exists).
    const farhan = await trainer('farhan');
    const hiraCert = (await ctx.owner.query('SELECT id FROM certificates WHERE user_id = $1', [ctx.ids.students.hira])).rows[0].id;
    expect((await farhan.post(`/api/certificates/${hiraCert}/revoke`, { reason: 'Not mine' })).statusCode).toBe(404);
  });

  it('serves public branding for the sign-in page', async () => {
    const res = await as(ctx.app, null).get('/api/branding');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      institute_name: 'CBID Institute', organisation_name: 'CBID Network PK Sindh', support_email: 'info@cbidnetwork.org',
      contact_phone: '+92 21 34155705', contact_address: 'B-52/1, Block 13-D/1, Jamali Road, Gulshan-e-Iqbal, Karachi',
      website_url: 'https://cbidnetwork.org',
    });
  });
});

describe('course audience and delivery mode', () => {
  it('are shown in the catalogue, filterable, and only administrators can change them', async () => {
    const amina = await learner('amina');
    const cat = await amina.get('/api/courses?scope=catalogue&mode=online');
    expect(cat.json().items.map((c: { code: string }) => c.code)).toEqual(['IET201']);
    expect(cat.json().items[0].audience).toBe('Teachers, school leaders and education officers');

    const { courses, teachers } = ctx.ids;
    await expect(asDbUser(ctx.appPool, teachers.sana, "UPDATE courses SET delivery_mode = 'onsite' WHERE id = $1", [courses.det]))
      .rejects.toThrow(/Only administrators/);
    const a = await admin();
    const res = await a.patch(`/api/admin/courses/${courses.det}`, { audience: 'Everyone', deliveryMode: 'onsite' });
    expect(res.statusCode).toBe(200);
    expect((await a.get(`/api/admin/courses/${courses.det}`)).json().course).toMatchObject({ audience: 'Everyone', deliveryMode: 'onsite' });
    expect((await a.patch(`/api/admin/courses/${courses.det}`, { deliveryMode: 'hybrid' })).statusCode).toBe(400);
  });
});
