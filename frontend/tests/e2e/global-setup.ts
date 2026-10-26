import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Migrates and re-seeds the e2e database so every run starts from the same fictional data. */
export default function globalSetup() {
  const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_OWNER_URL: process.env.E2E_DATABASE_OWNER_URL ?? 'postgres://cbid_owner:owner_dev_pw@localhost:5432/cbid_lms_e2e',
    SEED_PASSWORD: 'CbidDemo!2026',
  };
  if (!/_e2e$/.test(new URL(env.DATABASE_OWNER_URL).pathname)) throw new Error('E2E database name must end in _e2e');
  execSync('npx tsx src/scripts/migrate.ts', { cwd: backend, env, stdio: 'inherit' });
  execSync('npx tsx src/scripts/seed.ts --reset', { cwd: backend, env, stdio: 'inherit' });
}
