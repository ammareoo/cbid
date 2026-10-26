import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { withUser } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { branding, emailFooter } from '../../lib/branding.js';
import { AppError, unauthorized, unprocessable } from '../../lib/errors.js';
import {
  burnPasswordCheck, hashPassword, passwordProblem, randomToken, sha256, verifyPassword,
} from '../../lib/security.js';
import { clearSessionCookie, sessionCookieName, setSessionCookie } from '../../plugins/auth.js';
import { permissionsFor } from '../../permissions/policy.js';
import type { AuthContext } from '../../types.js';

const email = z.string().trim().toLowerCase().email().max(254);
const loginBody = z.object({ email, password: z.string().min(1).max(256) });
const forgotBody = z.object({ email });
const resetBody = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(256) });
const changeBody = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) });

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect, or the account is temporarily locked.';

export const sessionPayload = (a: AuthContext) => ({
  user: {
    id: a.userId,
    email: a.email,
    fullName: a.fullName,
    preferredName: a.preferredName,
    role: a.role,
    timezone: a.timezone,
    permissions: permissionsFor(a.role),
  },
  csrfToken: a.csrfToken,
  expiresAt: a.expiresAt,
});

export default async function authRoutes(app: FastifyInstance) {
  const cfg = app.config;
  const authLimit = { rateLimit: { max: cfg.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } };
  const recoveryLimit = { rateLimit: { max: cfg.RECOVERY_RATE_LIMIT, timeWindow: '15 minutes' } };

  async function startSession(userId: string, req: FastifyRequest, reply: FastifyReply) {
    const token = randomToken();
    const csrf = randomToken();
    await req.db((tx) =>
      tx.query('SELECT app.auth_create_session($1, $2, $3, $4::interval, $5::interval, $6::inet, $7)', [
        userId, sha256(token), csrf, `${cfg.SESSION_ABSOLUTE_HOURS} hours`, `${cfg.SESSION_IDLE_MINUTES} minutes`,
        req.ip || null, String(req.headers['user-agent'] ?? '').slice(0, 300),
      ]),
    );
    setSessionCookie(app, reply, token);
    return token;
  }

  async function resolveFresh(token: string) {
    return withUser(app.pool, null, (tx) =>
      tx.one<Record<string, unknown>>('SELECT * FROM app.auth_resolve_session($1, $2::interval)', [
        sha256(token), `${cfg.SESSION_IDLE_MINUTES} minutes`,
      ]),
    );
  }

  app.post('/login', { config: authLimit }, async (req, reply) => {
    const body = loginBody.parse(req.body);
    const user = await req.db((tx) =>
      tx.maybeOne<{ id: string; password_hash: string; status: string; locked_until: Date | null }>(
        'SELECT * FROM app.auth_lookup_user($1)', [body.email]),
    );

    if (!user) {
      await burnPasswordCheck(body.password);
      await req.db((tx) => audit(tx, req, 'auth.login_failed', 'user', null, { email: body.email, reason: 'unknown_email' }));
      throw unauthorized(GENERIC_LOGIN_ERROR);
    }

    const locked = user.locked_until && user.locked_until > new Date();
    const ok = !locked && user.status === 'active' && (await verifyPassword(user.password_hash, body.password));
    if (!ok) {
      if (!locked && user.status === 'active') {
        await req.db((tx) => tx.query('SELECT app.auth_login_failed($1, $2, $3::interval)', [
          user.id, cfg.LOGIN_MAX_ATTEMPTS, `${cfg.LOGIN_LOCK_MINUTES} minutes`]));
      }
      await req.db((tx) => audit(tx, req, 'auth.login_failed', 'user', user.id, {
        reason: locked ? 'locked' : user.status !== 'active' ? 'inactive' : 'bad_password' }));
      throw unauthorized(GENERIC_LOGIN_ERROR);
    }

    // Session fixation defence: drop any session that came in with this request.
    const existing = req.cookies[sessionCookieName(cfg.COOKIE_SECURE)];
    if (existing) await req.db((tx) => tx.query('SELECT app.auth_revoke_session($1)', [sha256(existing)]));

    const token = await startSession(user.id, req, reply);
    const row = await resolveFresh(token);
    await withUser(app.pool, user.id, (tx) => audit(tx, req, 'auth.login', 'user', user.id));
    reply.header('Cache-Control', 'no-store');
    return sessionPayload({
      userId: row.user_id as string, sessionId: row.session_id as string, role: row.role as AuthContext['role'],
      csrfToken: row.csrf_token as string, email: row.email as string, fullName: row.full_name as string,
      preferredName: row.preferred_name as string | null, timezone: row.timezone as string,
      expiresAt: (row.expires_at as Date).toISOString(),
    });
  });

  // Signed-out callers get 200 with user: null so the SPA can check its state without a console error.
  app.get('/session', async (req) => (req.auth ? sessionPayload(req.auth) : { user: null, csrfToken: null, expiresAt: null }));

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[sessionCookieName(cfg.COOKIE_SECURE)];
    if (token) {
      await req.db(async (tx) => {
        if (req.auth) await audit(tx, req, 'auth.logout', 'user', req.auth.userId);
        await tx.query('SELECT app.auth_revoke_session($1)', [sha256(token)]);
      });
    }
    clearSessionCookie(app, reply);
    reply.header('Clear-Site-Data', '"cookies", "storage"');
    return reply.code(204).send();
  });

  app.post('/password/forgot', { config: recoveryLimit }, async (req, reply) => {
    const { email: addr } = forgotBody.parse(req.body);
    const token = randomToken();
    await req.db(async (tx) => {
      const target = await tx.maybeOne<{ user_id: string; full_name: string }>(
        'SELECT * FROM app.auth_create_reset($1, $2, $3::interval)', [addr, sha256(token), `${cfg.PASSWORD_RESET_MINUTES} minutes`]);
      if (target) {
        const link = `${cfg.APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
        const b = await branding(tx);
        await tx.query('SELECT app.enqueue_email($1, $2, $3)', [
          addr,
          `Reset your ${b.institute_name} password`,
          `Hello ${target.full_name},\n\nUse this link to choose a new password. It expires in ${cfg.PASSWORD_RESET_MINUTES} minutes and can be used once:\n\n${link}\n\nIf you did not ask for this, you can ignore this email. Your password has not changed.\n${emailFooter(b)}`,
        ]);
        await audit(tx, req, 'auth.password_reset_requested', 'user', target.user_id);
      }
    });
    // Same response whether or not the account exists (no account enumeration).
    return reply.code(202).send({ message: 'If an account exists for that email, a reset link is on its way.' });
  });

  app.post('/password/reset', { config: recoveryLimit }, async (req, reply) => {
    const body = resetBody.parse(req.body);
    const problem = passwordProblem(body.password);
    if (problem) throw unprocessable(problem);
    const newHash = await hashPassword(body.password);
    const userId = await req.db((tx) =>
      tx.one<{ user_id: string | null }>('SELECT app.auth_consume_reset($1, $2) AS user_id', [sha256(body.token), newHash]),
    );
    if (!userId.user_id) throw new AppError(400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');
    await withUser(app.pool, userId.user_id, (tx) => audit(tx, req, 'auth.password_reset', 'user', userId.user_id));
    return reply.code(204).send();
  });

  app.post('/password/change', { preHandler: app.requireAuth, config: authLimit }, async (req, reply) => {
    const body = changeBody.parse(req.body);
    const auth = req.auth!;
    const problem = passwordProblem(body.newPassword, auth.email);
    if (problem) throw unprocessable(problem);
    const current = await req.db((tx) => tx.one<{ h: string }>('SELECT app.get_own_password_hash() AS h'));
    if (!(await verifyPassword(current.h, body.currentPassword))) throw unprocessable('Your current password is incorrect');
    const newHash = await hashPassword(body.newPassword);
    await req.db(async (tx) => {
      await tx.query('SELECT app.set_own_password($1)', [newHash]);
      await tx.query('SELECT app.auth_revoke_user_sessions($1)', [auth.userId]);
      await audit(tx, req, 'auth.password_changed', 'user', auth.userId);
    });
    // Rotate: every old session (including this one) is gone; issue a fresh one.
    const token = await startSession(auth.userId, req, reply);
    const row = await resolveFresh(token);
    return reply.send({ csrfToken: row.csrf_token });
  });
}
