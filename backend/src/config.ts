import 'dotenv/config';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const isProd = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default(isProd ? 'info' : 'debug'),

  /** API connection — must be the non-owner `cbid_app` role so RLS applies. */
  DATABASE_URL: z.string().url(),
  /** Owner connection — migrations, seed, worker only. Never used by request handlers. */
  DATABASE_OWNER_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),

  REDIS_URL: z.string().url().optional(),

  /** The browser origin of the frontend, e.g. https://lms.example.edu */
  APP_ORIGIN: z.string().url(),
  TRUST_PROXY: bool(false),
  COOKIE_SECURE: bool(isProd),

  SESSION_ABSOLUTE_HOURS: z.coerce.number().min(1).max(72).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(24 * 60).default(60),
  /** Per-client limit for sign-in attempts (per minute) and recovery requests (per 15 minutes). */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
  RECOVERY_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),
  PASSWORD_RESET_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  INVITE_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(72),

  UPLOAD_DIR: z.string().default('./storage/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(50).default(25),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('CBID Institute <no-reply@example.org>'),

  RETENTION_NOTIFICATIONS_DAYS: z.coerce.number().int().min(7).default(180),
  RETENTION_AUDIT_DAYS: z.coerce.number().int().min(90).default(730),
  RETENTION_EMAIL_DAYS: z.coerce.number().int().min(1).default(30),

  /** Optional: serve the built frontend from the API process (single-origin deployment). */
  SERVE_STATIC_DIR: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Empty values (e.g. `REDIS_URL=`) mean "not set".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    if (!cfg.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (!cfg.APP_ORIGIN.startsWith('https://')) throw new Error('APP_ORIGIN must use https in production');
    if (/app_dev_pw|owner_dev_pw|change_me/.test(cfg.DATABASE_URL)) {
      throw new Error('Refusing to start in production with a development database password');
    }
  }
  return cfg;
}
