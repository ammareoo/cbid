import 'dotenv/config';
import { createPool } from '../db/pool.js';
import { resetData, seed, SEED_EMAILS } from '../db/seed-data.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production environment.');
  process.exit(1);
}
const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('DATABASE_OWNER_URL is required.');
  process.exit(1);
}
const password = process.env.SEED_PASSWORD ?? 'CbidDemo!2026';
const pool = createPool(url, { max: 2 });

try {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
  if ((rows[0]?.n ?? 0) > 0 && !process.argv.includes('--reset')) {
    console.error('The database already has users. Re-run with --reset to wipe ALL data and reseed (development only).');
    process.exit(1);
  }
  if (process.argv.includes('--reset')) await resetData(pool);
  await seed(pool, password);
  console.log('Seeded fictional development data. Sign in with any of these accounts:');
  console.log(`  administrator  ${SEED_EMAILS.admin}`);
  console.log(`  trainer        ${SEED_EMAILS.teachers.sana}`);
  console.log(`  learner        ${SEED_EMAILS.students.amina}`);
  console.log(`  password       ${process.env.SEED_PASSWORD ? '(from SEED_PASSWORD)' : password}`);
} finally {
  await pool.end();
}
