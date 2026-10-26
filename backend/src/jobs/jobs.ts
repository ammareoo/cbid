import type { Pool } from '../db/pool.js';
import type { Mailer } from '../mail/mailer.js';

/**
 * Background jobs. They run on the OWNER connection (bypasses RLS) because they act on behalf
 * of the system, not a user. They take no user input; every row they touch was written through
 * RLS-checked paths or trusted functions.
 */

export async function sendPendingEmails(pool: Pool, mailer: Mailer, batch = 20): Promise<{ sent: number; failed: number }> {
  const client = await pool.connect();
  let sent = 0;
  let failed = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: number; to_address: string; subject: string; body_text: string; attempts: number }>(
      `SELECT id, to_address, subject, body_text, attempts FROM email_outbox
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [batch]);
    for (const m of rows) {
      try {
        await mailer.send({ to: m.to_address, subject: m.subject, text: m.body_text });
        await client.query(`UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [m.id]);
        sent++;
      } catch (err) {
        const attempts = m.attempts + 1;
        const give_up = attempts >= 6;
        // exponential backoff: 1, 2, 4, 8, 16 minutes
        await client.query(
          `UPDATE email_outbox SET attempts = $2, last_error = left($3, 500),
                  status = CASE WHEN $4 THEN 'failed' ELSE 'pending' END,
                  next_attempt_at = now() + make_interval(mins => $5)
            WHERE id = $1`,
          [m.id, attempts, (err as Error).message, give_up, 2 ** (attempts - 1)]);
        failed++;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return { sent, failed };
}

export async function finalizeExpiredAttempts(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>('SELECT app.finalize_expired_attempts() AS n');
  return rows[0]?.n ?? 0;
}

export async function purgeExpired(pool: Pool, retention: { notificationDays: number; auditDays: number; emailDays: number }) {
  const { rows } = await pool.query<{ r: Record<string, number> }>(
    'SELECT app.purge_expired($1, $2, $3) AS r', [retention.notificationDays, retention.auditDays, retention.emailDays]);
  return rows[0]?.r ?? {};
}

export async function heartbeat(pool: Pool, worker: string, result: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO worker_heartbeats (worker, last_beat, last_result) VALUES ($1, now(), $2::jsonb)
     ON CONFLICT (worker) DO UPDATE SET last_beat = now(), last_result = EXCLUDED.last_result`,
    [worker, JSON.stringify(result)]);
}
