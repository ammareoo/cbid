import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';
import { hashPassword, passwordProblem } from '../lib/security.js';

/**
 * Administrator accounts are provisioned by the system owner from the server, never through
 * the web API. Usage: npm run create-admin -- --email ops@example.edu --name "Registrar"
 * The password is read interactively (or from ADMIN_PASSWORD for automation).
 */
const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const email = arg('--email')?.toLowerCase();
const name = arg('--name');
const url = process.env.DATABASE_OWNER_URL;
if (!email || !name || !url) {
  console.error('Usage: DATABASE_OWNER_URL=... npm run create-admin -- --email <email> --name "<full name>"');
  process.exit(1);
}

let password = process.env.ADMIN_PASSWORD;
if (!password) {
  const rl = createInterface({ input: stdin, output: stdout });
  password = await rl.question('Password for the new administrator: ');
  rl.close();
}
const problem = passwordProblem(password, email);
if (problem) {
  console.error(problem);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const hash = await hashPassword(password);
  await client.query('BEGIN');
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash, status = 'active'
     RETURNING id`, [email, hash, name]);
  await client.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (NULL, 'user.admin_provisioned', 'user', $1, '{"via":"cli"}')`,
    [rows[0]!.id]);
  await client.query('COMMIT');
  console.log(`Administrator ready: ${email}`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
