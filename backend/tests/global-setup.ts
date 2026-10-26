import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

export const TEST_OWNER_URL = process.env.TEST_DATABASE_OWNER_URL ?? 'postgres://cbid_owner:owner_dev_pw@localhost:5432/cbid_lms_test';

/** Rebuilds the dedicated test database schema from migrations before the suite runs. */
export default async function setup() {
  if (!/_test$/.test(new URL(TEST_OWNER_URL).pathname)) {
    throw new Error('Refusing to run tests against a database whose name does not end in _test');
  }
  const client = new pg.Client({ connectionString: TEST_OWNER_URL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user");
    for (const r of rows) await client.query(`DROP TABLE IF EXISTS public."${r.tablename}" CASCADE`);
  } finally {
    await client.end();
  }
  await runMigrations(TEST_OWNER_URL);
}
