import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Redis } from 'ioredis';
import type { Config } from './config.js';
import { createPool, type Pool } from './db/pool.js';
import { toPublicError } from './lib/errors.js';
import { FileStore } from './lib/storage.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './modules/auth/auth.routes.js';
import meRoutes from './modules/me/me.routes.js';
import courseRoutes from './modules/courses/courses.routes.js';
import contentRoutes from './modules/content/content.routes.js';
import assignmentRoutes from './modules/assignments/assignments.routes.js';
import quizRoutes from './modules/quizzes/quizzes.routes.js';
import communicationRoutes from './modules/communication/communication.routes.js';
import fileRoutes from './modules/files/files.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import certificateRoutes from './modules/certificates/certificates.routes.js';
import { branding } from './lib/branding.js';
import './types.js';

export interface BuildOptions {
  pool?: Pool;
  redis?: Redis | null;
  logger?: boolean;
}

export async function buildApp(config: Config, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: config.LOG_LEVEL,
      redact: { paths: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers.authorization'], remove: true },
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestTimeout: 60_000,
  });

  const pool = opts.pool ?? createPool(config.DATABASE_URL, {
    max: config.DB_POOL_MAX, statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS, appName: 'cbid-lms-api',
  });
  const redis = opts.redis !== undefined ? opts.redis
    : config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false }) : null;

  app.decorate('config', config);
  app.decorate('pool', pool);
  app.decorate('files', new FileStore(path.resolve(config.UPLOAD_DIR), config.MAX_UPLOAD_MB * 1024 * 1024));
  if (redis) app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    if (!opts.pool) await pool.end();
    if (redis && opts.redis === undefined) redis.disconnect();
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: config.COOKIE_SECURE ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  await app.register(cors, {
    origin: [new URL(config.APP_ORIGIN).origin],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(authPlugin);
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    redis: redis ?? undefined,
    nameSpace: 'cbid-rl:',
    skipOnError: true,
    keyGenerator: (req) => (req.auth ? `u:${req.auth.userId}` : `ip:${req.ip}`),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.` },
    }),
  });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5, parts: 6, headerPairs: 100 },
    throwFileSizeLimit: true,
  });

  app.setErrorHandler((err, req, reply) => {
    const pub = toPublicError(err);
    if (pub.statusCode >= 500) req.log.error({ err }, 'request failed');
    else req.log.info({ code: pub.code, status: pub.statusCode, url: req.url }, 'request rejected');
    reply.status(pub.statusCode).send({ error: { code: pub.code, message: pub.message, details: pub.details } });
  });
  app.setNotFoundHandler((req, reply) => {
    // SPA fallback only for page navigations; missing assets and API routes stay 404.
    const pathOnly = req.url.split('?')[0] ?? '';
    if (req.url.startsWith('/api/') || !config.SERVE_STATIC_DIR || /\.[a-z0-9]+$/i.test(pathOnly)) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
    }
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.get('/api/health', { config: { rateLimit: false } }, async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });

  app.get('/api/settings/public', { preHandler: app.requireAuth }, async (req) => {
    const rows = await req.db((tx) => tx.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM system_settings WHERE key IN ('institute_name', 'organisation_name', 'support_email', 'contact_phone',
         'contact_address', 'website_url', 'maintenance_banner', 'self_enrollment_enabled')`));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  // Branding for the sign-in and certificate verification pages (no session; whitelisted keys only).
  app.get('/api/branding', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    return req.db((tx) => branding(tx));
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(meRoutes, { prefix: '/api/me' });
  await app.register(courseRoutes, { prefix: '/api/courses' });
  await app.register(contentRoutes, { prefix: '/api' });
  await app.register(assignmentRoutes, { prefix: '/api' });
  await app.register(quizRoutes, { prefix: '/api' });
  await app.register(communicationRoutes, { prefix: '/api' });
  await app.register(fileRoutes, { prefix: '/api' });
  await app.register(certificateRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  if (config.SERVE_STATIC_DIR) {
    await app.register(fastifyStatic, {
      root: path.resolve(config.SERVE_STATIC_DIR),
      wildcard: true,
      setHeaders: (reply, filePath) => {
        reply.header('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  return app;
}
