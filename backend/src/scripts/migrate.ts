import 'dotenv/config';
import { runMigrations } from '../db/migrate.js';

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('DATABASE_OWNER_URL is required to run migrations (owner role, not the API role).');
  process.exit(1);
}

runMigrations(url)
  .then((r) => {
    console.log(`Applied ${r.applied.length} migration(s)${r.applied.length ? ': ' + r.applied.join(', ') : ''}.`);
    console.log(`${r.skipped.length} already applied.`);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
