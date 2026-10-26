import pg from 'pg';

// numeric -> number (scores/points are bounded to 2 decimal places, safely representable)
pg.types.setTypeParser(1700, (v) => parseFloat(v));
// int8 (counts) -> number
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

export type Pool = pg.Pool;

export function createPool(connectionString: string, opts: { max?: number; statementTimeoutMs?: number; appName?: string } = {}) {
  return new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: opts.appName ?? 'cbid-lms',
    statement_timeout: opts.statementTimeoutMs ?? 10_000,
    // Time zone is always UTC at the database boundary; the UI converts to the user's zone.
    options: '-c timezone=UTC',
  });
}

/** A transaction-scoped query runner. All request work goes through one of these. */
export interface Tx {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T>;
  maybeOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null>;
}

function wrap(client: pg.PoolClient): Tx {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const r = await client.query(text, params);
      return r.rows as T[];
    },
    async one<T>(text: string, params: unknown[] = []) {
      const r = await client.query(text, params);
      if (r.rows.length !== 1) throw new Error(`Expected exactly one row, got ${r.rows.length}`);
      return r.rows[0] as T;
    },
    async maybeOne<T>(text: string, params: unknown[] = []) {
      const r = await client.query(text, params);
      return (r.rows[0] as T | undefined) ?? null;
    },
  };
}

/**
 * Runs `fn` inside a transaction with the database identity set to `userId`.
 * `app.user_id` is transaction-local (set_config(..., true)), so pooled connections never
 * leak identity between requests. `userId` must come from a server-validated session.
 */
export async function withUser<T>(pool: Pool, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(wrap(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
