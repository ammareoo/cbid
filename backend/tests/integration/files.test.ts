import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, ORIGIN, SEED_EMAILS, sessions, setupContext, teardown, type Ctx, type Session } from '../helpers.js';

let ctx: Ctx;
let session: ReturnType<typeof sessions>;
beforeAll(async () => {
  ctx = await setupContext({ MAX_UPLOAD_MB: '1' });
  session = sessions(ctx.app);
});
afterAll(async () => { await teardown(ctx); });

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'), Buffer.alloc(200, 32), Buffer.from('\n%%EOF\n')]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(400, 0x90)]);

function multipart(filename: string, content: Buffer, type = 'application/octet-stream') {
  const boundary = '----cbidtest' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(s: Session, courseId: string, purpose: string, filename: string, content: Buffer) {
  const { body, contentType } = multipart(filename, content);
  return ctx.app.inject({
    method: 'POST', url: `/api/courses/${courseId}/files?purpose=${purpose}`, payload: body,
    headers: { origin: ORIGIN, cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': contentType },
  });
}

describe('uploads', () => {
  it('accepts a real PDF submission and attaches it', async () => {
    const amina = await session(SEED_EMAILS.students.amina);
    const res = await upload(amina, ctx.ids.courses.det, 'submission', 'barrier report.pdf', PDF);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ originalName: 'barrier report.pdf', mimeType: 'application/pdf' });
    const sub = await as(ctx.app, amina).post(`/api/assignments/${ctx.ids.assignments.barrierReport}/submissions`, { fileId: res.json().id });
    expect(sub.statusCode).toBe(201);
    expect(sub.json().fileName).toBe('barrier report.pdf');
  });

  it('rejects an executable disguised as a PDF', async () => {
    const amina = await session(SEED_EMAILS.students.amina);
    const res = await upload(amina, ctx.ids.courses.det, 'submission', 'notes.pdf', EXE);
    expect(res.statusCode).toBe(415);
  });

  it('accepts UTF-8 text but rejects binary content with a .txt name', async () => {
    const amina = await session(SEED_EMAILS.students.amina);
    expect((await upload(amina, ctx.ids.courses.det, 'submission', 'answer.txt', Buffer.from('میرا جواب — my answer\n'))).statusCode).toBe(201);
    expect((await upload(amina, ctx.ids.courses.det, 'submission', 'answer.txt', Buffer.from([0, 1, 2, 3, 0, 255]))).statusCode).toBe(415);
  });

  it('rejects files above the size limit', async () => {
    const amina = await session(SEED_EMAILS.students.amina);
    const big = Buffer.concat([PDF, Buffer.alloc(1.2 * 1024 * 1024, 32)]);
    expect((await upload(amina, ctx.ids.courses.det, 'submission', 'big.pdf', big)).statusCode).toBe(413);
  });

  it('refuses uploads to courses the user does not belong to, and material uploads by students', async () => {
    const kamran = await session(SEED_EMAILS.students.kamran);
    expect((await upload(kamran, ctx.ids.courses.det, 'submission', 'x.pdf', PDF)).statusCode).toBe(404);
    const amina = await session(SEED_EMAILS.students.amina);
    expect((await upload(amina, ctx.ids.courses.det, 'material', 'x.pdf', PDF)).statusCode).toBe(403);
  });
});

describe('downloads are authorised per file', () => {
  it('lets the owner and the course teacher download a submission, but not another student', async () => {
    const amina = await session(SEED_EMAILS.students.amina);
    const up = await upload(amina, ctx.ids.courses.det, 'submission', 'private.pdf', PDF);
    const url = `/api/files/${up.json().id}`;
    const own = await as(ctx.app, amina).get(url);
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-disposition']).toMatch(/^attachment; filename="private.pdf"/);
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect(own.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    expect((await as(ctx.app, await session(SEED_EMAILS.teachers.sana)).get(url)).statusCode).toBe(200);
    expect((await as(ctx.app, await session(SEED_EMAILS.students.bilal)).get(url)).statusCode).toBe(404);
    expect((await as(ctx.app, await session(SEED_EMAILS.teachers.farhan)).get(url)).statusCode).toBe(404);
  });

  it('shares course materials only with enrolled learners once published', async () => {
    const sana = await session(SEED_EMAILS.teachers.sana);
    const up = await upload(sana, ctx.ids.courses.det, 'material', 'reading.pdf', PDF);
    expect(up.statusCode).toBe(201);
    const mod = (await as(ctx.app, sana).post(`/api/courses/${ctx.ids.courses.det}/modules`, { title: 'Readings', published: true })).json();
    const item = await as(ctx.app, sana).post(`/api/modules/${mod.id}/items`, { kind: 'file', title: 'Reading pack', fileId: up.json().id, published: false });
    expect(item.statusCode).toBe(201);
    const url = `/api/files/${up.json().id}`;
    const bilal = await session(SEED_EMAILS.students.bilal);
    expect((await as(ctx.app, bilal).get(url)).statusCode).toBe(404); // item unpublished
    await as(ctx.app, sana).patch(`/api/items/${item.json().id}`, { published: true });
    expect((await as(ctx.app, bilal).get(url)).statusCode).toBe(200);
    expect((await as(ctx.app, await session(SEED_EMAILS.students.kamran)).get(url)).statusCode).toBe(404); // not enrolled
  });
});
