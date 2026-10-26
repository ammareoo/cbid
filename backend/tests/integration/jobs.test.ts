import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finalizeExpiredAttempts, purgeExpired, sendPendingEmails } from '../../src/jobs/jobs.js';
import type { Mailer, MailMessage } from '../../src/mail/mailer.js';
import { as, SEED_EMAILS, sessions, setupContext, teardown, type Ctx } from '../helpers.js';

let ctx: Ctx;
beforeAll(async () => { ctx = await setupContext(); });
afterAll(async () => { await teardown(ctx); });

describe('email outbox worker', () => {
  it('sends pending messages and retries failures with backoff', async () => {
    await ctx.owner.query(`INSERT INTO email_outbox (to_address, subject, body_text) VALUES
      ('ok@cbid.example', 'Hello', 'Body'), ('fail@cbid.example', 'Hello', 'Body')`);
    const sent: MailMessage[] = [];
    const mailer: Mailer = {
      kind: 'dev-file',
      async send(m) {
        if (m.to.startsWith('fail')) throw new Error('SMTP 451 temporary failure');
        sent.push(m);
      },
    };
    const r = await sendPendingEmails(ctx.owner, mailer);
    expect(r).toEqual({ sent: 1, failed: 1 });
    expect(sent[0]!.to).toBe('ok@cbid.example');
    const { rows } = await ctx.owner.query("SELECT status, attempts, next_attempt_at > now() AS deferred FROM email_outbox WHERE to_address = 'fail@cbid.example'");
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, deferred: true });
    expect(await sendPendingEmails(ctx.owner, mailer)).toEqual({ sent: 0, failed: 0 }); // backoff respected
  });
});

describe('retention and expiry', () => {
  it('prunes expired sessions, old notifications and old audit rows but keeps recent ones', async () => {
    const { students } = ctx.ids;
    await ctx.owner.query(`INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at, idle_expires_at)
      VALUES ($1, '\\x01', 'x', now() - interval '1 hour', now() - interval '2 hours'),
             ($1, '\\x02', 'y', now() + interval '1 hour', now() + interval '1 hour')`, [students.amina]);
    await ctx.owner.query(`INSERT INTO notifications (user_id, kind, title, created_at) VALUES ($1, 'system', 'old', now() - interval '400 days')`, [students.amina]);
    await ctx.owner.query(`INSERT INTO audit_logs (action, created_at) VALUES ('test.old', now() - interval '1000 days'), ('test.new', now())`);
    const r = await purgeExpired(ctx.owner, { notificationDays: 180, auditDays: 730, emailDays: 30 });
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    expect(r.notifications).toBe(1);
    expect(r.audit_logs).toBe(1);
    const left = await ctx.owner.query("SELECT count(*)::int AS n FROM sessions WHERE token_hash IN ('\\x01', '\\x02')");
    expect(left.rows[0].n).toBe(1);
    const audit = await ctx.owner.query("SELECT action FROM audit_logs WHERE action LIKE 'test.%'");
    expect(audit.rows.map((x) => x.action)).toEqual(['test.new']);
  });

  it('closes quiz attempts whose time ran out and scores the saved answers', async () => {
    const s = sessions(ctx.app);
    const hira = as(ctx.app, await s(SEED_EMAILS.students.hira));
    const id = (await hira.post(`/api/quizzes/${ctx.ids.quizzes.Q1}/attempts`)).json().id;
    const att = (await hira.get(`/api/attempts/${id}`)).json();
    const q3 = att.questions.find((q: { kind: string }) => q.kind === 'short');
    await hira.put(`/api/attempts/${id}/answers/${q3.id}`, { textAnswer: 'CRPD' });
    await ctx.owner.query("UPDATE quiz_attempts SET deadline_at = now() - interval '5 minutes' WHERE id = $1", [id]);
    expect((await hira.put(`/api/attempts/${id}/answers/${q3.id}`, { textAnswer: 'changed' })).statusCode).toBe(422);
    expect(await finalizeExpiredAttempts(ctx.owner)).toBe(1);
    const { rows } = await ctx.owner.query('SELECT status, score, max_score FROM quiz_attempts WHERE id = $1', [id]);
    expect(rows[0]).toMatchObject({ status: 'submitted', score: 1, max_score: 5 });
  });
});
