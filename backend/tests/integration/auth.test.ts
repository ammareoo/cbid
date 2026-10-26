import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, login, ORIGIN, PASSWORD, SEED_EMAILS, setupContext, teardown, type Ctx } from '../helpers.js';

let ctx: Ctx;
beforeAll(async () => { ctx = await setupContext(); });
afterAll(async () => { await teardown(ctx); });

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'POST', url, payload: payload as never, headers: { origin: ORIGIN, ...headers } });

describe('login and sessions', () => {
  it('signs in with valid credentials and sets a hardened session cookie', async () => {
    const res = await post('/api/auth/login', { email: SEED_EMAILS.students.amina, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    const body = res.json();
    expect(body.user.role).toBe('student');
    expect(body.csrfToken).toHaveLength(43);
    expect(JSON.stringify(body)).not.toMatch(/password/i);
  });

  it('returns the same generic error for a wrong password and an unknown email', async () => {
    const wrong = await post('/api/auth/login', { email: SEED_EMAILS.students.bilal, password: 'not-the-password' });
    const unknown = await post('/api/auth/login', { email: 'nobody@cbid.example', password: 'whatever-123' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it('locks an account after repeated failures, even for the right password', async () => {
    const email = SEED_EMAILS.students.kamran;
    for (let i = 0; i < 5; i++) await post('/api/auth/login', { email, password: 'wrong-password-x' }, { 'x-forwarded-for': `10.0.0.${i}` });
    const res = await post('/api/auth/login', { email, password: PASSWORD });
    expect(res.statusCode).toBe(401);
    const { rows } = await ctx.owner.query('SELECT locked_until > now() AS locked FROM users WHERE email = $1', [email]);
    expect(rows[0].locked).toBe(true);
  });

  it('rejects a session cookie after logout (server-side revocation)', async () => {
    const s = await login(ctx.app, SEED_EMAILS.students.zara);
    expect((await as(ctx.app, s).get('/api/auth/session')).statusCode).toBe(200);
    const out = await as(ctx.app, s).post('/api/auth/logout');
    expect(out.statusCode).toBe(204);
    expect((await as(ctx.app, s).get('/api/auth/session')).json().user).toBeNull();
  });

  it('rejects state-changing requests without a valid CSRF token', async () => {
    const s = await login(ctx.app, SEED_EMAILS.students.omar);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: { origin: ORIGIN, cookie: s.cookie } });
    expect(res.statusCode).toBe(403);
    const forged = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: { origin: ORIGIN, cookie: s.cookie, 'x-csrf-token': 'forged' } });
    expect(forged.statusCode).toBe(403);
    expect((await as(ctx.app, s).post('/api/notifications/read-all')).statusCode).toBe(200);
  });

  it('rejects cross-origin state-changing requests', async () => {
    const res = await post('/api/auth/login', { email: SEED_EMAILS.students.amina, password: PASSWORD }, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    const fetchMeta = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: {}, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(fetchMeta.statusCode).toBe(403);
  });

  it('requires authentication for private endpoints', async () => {
    for (const url of ['/api/me/dashboard', '/api/courses', '/api/admin/users', '/api/notifications']) {
      expect((await as(ctx.app, null).get(url)).statusCode).toBe(401);
    }
  });

  it('sends security headers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('password recovery and change', () => {
  it('runs the full reset flow with single-use tokens and revokes sessions', async () => {
    const email = SEED_EMAILS.students.fatima;
    const before = await login(ctx.app, email);

    const res = await post('/api/auth/password/forgot', { email });
    expect(res.statusCode).toBe(202);
    const unknown = await post('/api/auth/password/forgot', { email: 'ghost@cbid.example' });
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json().message).toBe(res.json().message);

    const { rows } = await ctx.owner.query("SELECT body_text FROM email_outbox WHERE to_address = $1 ORDER BY id DESC LIMIT 1", [email]);
    const token = decodeURIComponent(/token=([^\s&]+)/.exec(rows[0].body_text)![1]!);

    expect((await post('/api/auth/password/reset', { token, password: 'short' })).statusCode).toBe(422);
    const ok = await post('/api/auth/password/reset', { token, password: 'New-Monsoon-Password-9' });
    expect(ok.statusCode).toBe(204);
    expect((await post('/api/auth/password/reset', { token, password: 'Another-Password-77' })).statusCode).toBe(400);

    expect((await as(ctx.app, before).get('/api/auth/session')).json().user).toBeNull();
    expect((await post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(401);
    await login(ctx.app, email, 'New-Monsoon-Password-9');
  });

  it('changes password with the current password and rotates the session', async () => {
    const email = SEED_EMAILS.students.usman;
    const s = await login(ctx.app, email);
    const bad = await as(ctx.app, s).post('/api/auth/password/change', { currentPassword: 'nope-nope-nope', newPassword: 'Karakoram-Peaks-88' });
    expect(bad.statusCode).toBe(422);
    const res = await as(ctx.app, s).post('/api/auth/password/change', { currentPassword: PASSWORD, newPassword: 'Karakoram-Peaks-88' });
    expect(res.statusCode).toBe(200);
    expect((await as(ctx.app, s).get('/api/auth/session')).json().user).toBeNull();
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    const fresh = await ctx.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    expect(fresh.json().user.email).toBe(email);
  });
});

