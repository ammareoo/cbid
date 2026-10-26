import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { resetData, seed, SEED_EMAILS, type SeedIds } from '../src/db/seed-data.js';
import { TEST_OWNER_URL } from './global-setup.js';

export const PASSWORD = 'Test-Password-2026!';
export const ORIGIN = 'http://localhost:5173';
export { SEED_EMAILS };

const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://cbid_app:app_dev_pw@localhost:5432/cbid_lms_test';

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: APP_URL,
    DATABASE_OWNER_URL: TEST_OWNER_URL,
    APP_ORIGIN: ORIGIN,
    COOKIE_SECURE: 'false',
    LOG_LEVEL: 'silent',
    UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'cbid-uploads-')),
    LOGIN_MAX_ATTEMPTS: '5',
    AUTH_RATE_LIMIT_PER_MINUTE: '200',
    RECOVERY_RATE_LIMIT: '200',
    ...overrides,
  });
}

export interface Ctx {
  app: FastifyInstance;
  owner: Pool;
  appPool: Pool;
  ids: SeedIds;
}

export async function setupContext(overrides: Record<string, string> = {}): Promise<Ctx> {
  const owner = createPool(TEST_OWNER_URL, { max: 3 });
  await resetData(owner);
  const ids = await seed(owner, PASSWORD);
  const config = testConfig(overrides);
  const appPool = createPool(config.DATABASE_URL, { max: 5 });
  const app = await buildApp(config, { pool: appPool, redis: null, logger: false });
  await app.ready();
  return { app, owner, appPool, ids };
}

export async function teardown(ctx: Ctx) {
  await ctx.app.close();
  await ctx.appPool.end();
  await ctx.owner.end();
}

export interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  const body = res.json();
  return { cookie: raw.split(';')[0]!, csrf: body.csrfToken, userId: body.user.id };
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Request helper that behaves like the SPA: same-origin, session cookie, CSRF header. */
export function as(app: FastifyInstance, s: Session | null) {
  const call = (method: Method, url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
    app.inject({
      method,
      url,
      payload: payload as never,
      headers: {
        origin: ORIGIN,
        ...(s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {}),
        ...headers,
      },
    });
  return {
    get: (url: string, headers?: Record<string, string>) => call('GET', url, undefined, headers),
    post: (url: string, payload?: unknown, headers?: Record<string, string>) => call('POST', url, payload ?? {}, headers),
    put: (url: string, payload?: unknown) => call('PUT', url, payload ?? {}),
    patch: (url: string, payload?: unknown) => call('PATCH', url, payload ?? {}),
    del: (url: string) => call('DELETE', url),
  };
}

/** Caches one session per email within a test file (keeps us under the login rate limit). */
export function sessions(app: FastifyInstance) {
  const cache = new Map<string, Promise<Session>>();
  return (email: string) => {
    if (!cache.has(email)) cache.set(email, login(app, email));
    return cache.get(email)!;
  };
}

/** Run SQL directly as the API role with a given identity, exactly as the API would. */
export async function asDbUser<T = Record<string, unknown>>(pool: Pool, userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const r = await client.query(sql, params);
    await client.query('COMMIT');
    return r.rows as T[];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
