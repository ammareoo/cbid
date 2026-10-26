import { hostname } from 'node:os';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { finalizeExpiredAttempts, heartbeat, purgeExpired, sendPendingEmails } from './jobs/jobs.js';
import { createMailer } from './mail/mailer.js';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
if (!config.DATABASE_OWNER_URL) {
  log.fatal('DATABASE_OWNER_URL is required for the worker');
  process.exit(1);
}
const pool = createPool(config.DATABASE_OWNER_URL, { max: 3, appName: 'cbid-lms-worker' });
const mailer = createMailer({ smtpUrl: config.SMTP_URL, from: config.MAIL_FROM, env: config.NODE_ENV });
const name = `worker@${hostname()}`;

let lastPurge = 0;
let stopping = false;

async function tick() {
  const result: Record<string, unknown> = {};
  try {
    result.email = await sendPendingEmails(pool, mailer);
    result.expiredAttemptsClosed = await finalizeExpiredAttempts(pool);
    if (Date.now() - lastPurge > 60 * 60 * 1000) {
      // Only one worker purges at a time.
      const { rows } = await pool.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(727275) AS locked');
      if (rows[0]?.locked) {
        try {
          result.purged = await purgeExpired(pool, {
            notificationDays: config.RETENTION_NOTIFICATIONS_DAYS,
            auditDays: config.RETENTION_AUDIT_DAYS,
            emailDays: config.RETENTION_EMAIL_DAYS,
          });
          lastPurge = Date.now();
        } finally {
          await pool.query('SELECT pg_advisory_unlock(727275)');
        }
      }
    }
    await heartbeat(pool, name, result);
    log.debug(result, 'tick');
  } catch (err) {
    log.error({ err }, 'worker tick failed');
  }
}

for (const s of ['SIGINT', 'SIGTERM'] as const) {
  process.on(s, async () => {
    stopping = true;
    await pool.end();
    process.exit(0);
  });
}

log.info({ mailer: mailer.kind }, 'worker started');
while (!stopping) {
  await tick();
  await new Promise((r) => setTimeout(r, 15_000));
}
