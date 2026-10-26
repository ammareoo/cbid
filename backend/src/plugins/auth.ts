import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withUser } from '../db/pool.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { safeEqual, sha256 } from '../lib/security.js';
import { can, isRole, type Permission } from '../permissions/policy.js';
import type { AuthContext } from '../types.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Endpoints that are called before a CSRF token exists. They are still Origin-checked. */
const CSRF_EXEMPT = new Set(['/api/auth/login', '/api/auth/password/forgot', '/api/auth/password/reset']);

export const sessionCookieName = (secure: boolean) => (secure ? '__Host-cbid_session' : 'cbid_session');

export function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string) {
  const cfg = app.config;
  reply.setCookie(sessionCookieName(cfg.COOKIE_SECURE), token, {
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(cfg.SESSION_ABSOLUTE_HOURS * 3600),
  });
}

export function clearSessionCookie(app: FastifyInstance, reply: FastifyReply) {
  reply.clearCookie(sessionCookieName(app.config.COOKIE_SECURE), {
    path: '/', httpOnly: true, secure: app.config.COOKIE_SECURE, sameSite: 'lax',
  });
}

interface SessionRow {
  session_id: string;
  user_id: string;
  role: string;
  csrf_token: string;
  email: string;
  full_name: string;
  preferred_name: string | null;
  timezone: string;
  expires_at: Date;
}

async function authPlugin(app: FastifyInstance) {
  const cfg = app.config;
  const cookieName = sessionCookieName(cfg.COOKIE_SECURE);
  const allowedOrigin = new URL(cfg.APP_ORIGIN).origin;

  app.decorateRequest('auth', null);
  app.decorateRequest('db', function db() {
    throw new Error('db not initialised');
  });

  app.addHook('onRequest', async (req) => {
    req.db = <T>(fn: Parameters<typeof withUser<T>>[2]) => withUser(app.pool, req.auth?.userId ?? null, fn);

    // 1. Cross-origin protection for state-changing requests (OWASP: Origin + Fetch Metadata).
    if (UNSAFE.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== allowedOrigin) throw forbidden('Cross-origin request blocked');
      if (!origin && req.headers['sec-fetch-site'] === 'cross-site') throw forbidden('Cross-site request blocked');
    }

    // 2. Resolve the session from the opaque cookie token.
    const token = req.cookies[cookieName];
    if (token && token.length <= 100) {
      const row = await withUser(app.pool, null, (tx) =>
        tx.maybeOne<SessionRow>('SELECT * FROM app.auth_resolve_session($1, $2::interval)', [
          sha256(token),
          `${cfg.SESSION_IDLE_MINUTES} minutes`,
        ]),
      );
      if (row && isRole(row.role)) {
        const ctx: AuthContext = {
          userId: row.user_id,
          sessionId: row.session_id,
          role: row.role,
          csrfToken: row.csrf_token,
          email: row.email,
          fullName: row.full_name,
          preferredName: row.preferred_name,
          timezone: row.timezone,
          expiresAt: row.expires_at.toISOString(),
        };
        req.auth = ctx;
      }
    }

    // 3. Synchronizer-token CSRF check for authenticated state-changing requests.
    if (req.auth && UNSAFE.has(req.method) && !CSRF_EXEMPT.has(req.routeOptions.url ?? '')) {
      const sent = req.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !safeEqual(sent, req.auth.csrfToken)) {
        throw forbidden('Your session security token is missing or out of date. Refresh the page and try again.');
      }
    }
  });

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    if (!req.auth) throw unauthorized();
  });

  app.decorate('requirePermission', (permission: Permission) => async (req: FastifyRequest) => {
    if (!req.auth) throw unauthorized();
    if (!can(req.auth.role, permission)) throw forbidden();
  });
}

export default fp(authPlugin, { name: 'cbid-auth', dependencies: ['@fastify/cookie'] });
