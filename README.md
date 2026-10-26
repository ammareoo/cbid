<<<<<<< HEAD
# CBID Institute LMS

The learning platform of **CBID Institute**, the Centre of Excellence of **CBID Network PK Sindh**
(Community Based Inclusive Development Network Pakistan, [cbidnetwork.org](https://cbidnetwork.org)).
It delivers the institute's training programmes (Disability Equality, Independent Living, Inclusive Business,
Inclusive Education, Capacity Building Workshops and Customized Training) online, in blended form and onsite
in Karachi, and issues certificates that anyone can verify. It has three role-specific workspaces
(learner, trainer, administrator) on one secure, database-driven core.

**Setting it up?** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) is the step-by-step guide: trying it on your own
computer, and the full server deployment (Ubuntu, PostgreSQL, nginx, HTTPS, email, backups).

How the platform was aligned with the institute's website (identity, programmes, audiences, contact details,
certification) is described in [`docs/CBID-ALIGNMENT.md`](docs/CBID-ALIGNMENT.md).

- **Frontend:** React 19, TypeScript, Vite, React Router, TanStack Query, lucide icons. Self-hosted fonts, no external calls.
- **Backend:** Node.js 22, TypeScript, Fastify 5, Zod validation, `pg` with parameterised SQL (no ORM).
- **Database:** PostgreSQL 16 with Row-Level Security, guard triggers and plain-SQL migrations.
- **Optional:** Redis for shared rate limiting. SMTP for email.
- **Background worker:** sends email, closes timed-out quiz attempts and applies the retention policy.

Screenshots of each workspace, the certificate and the public verification page (desktop, mobile and dark theme)
are in [`docs/screenshots/`](docs/screenshots/).

See [`docs/FEATURES.md`](docs/FEATURES.md) for what is implemented and the known limitations, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for design decisions and the API, and [`docs/SECURITY.md`](docs/SECURITY.md) for the security model and RLS policy matrix.

```
cbid-lms/
  backend/        Fastify API, worker, scripts, tests (Vitest)
    src/modules/  auth · me · courses · content · assignments · quizzes · communication · files · certificates · admin
    src/db/       pool + per-request identity, migration runner, development seed
    tests/        unit/ and integration/ (real PostgreSQL, incl. RLS tests)
  frontend/       React app, design system, unit tests (Vitest + Testing Library), e2e (Playwright)
    src/pages/    auth · public (certificate verification) · shared · student · teacher · course · admin
    src/assets/   CBID Institute and CBID Network PK Sindh logos (from cbidnetwork.org)
  database/       bootstrap.sql (roles), migrations/ (schema, RLS, functions), docker-init.sh
  docs/           DEPLOYMENT, CBID-ALIGNMENT, ARCHITECTURE, SECURITY, FEATURES, screenshots/
  scripts/        e2e-server.sh
```

## Prerequisites

- Node.js 22 (20.11+ works) and npm
- PostgreSQL 16 (15+ should work; 16 is what was tested)
- Optional: Redis 7, an SMTP account, Docker

## Local setup

```bash
# 1. Install dependencies
npm --prefix backend install
npm --prefix frontend install

# 2. Create the database roles, database and extensions (once, as a PostgreSQL superuser).
#    Choose your own passwords.
psql -U postgres -v owner_pw="'owner-password-here'" -v app_pw="'app-password-here'" -v db=cbid_lms -f database/bootstrap.sql

# 3. Configure the API
cp .env.example backend/.env
#    edit backend/.env: DATABASE_URL (cbid_app), DATABASE_OWNER_URL (cbid_owner), APP_ORIGIN=http://localhost:5173

# 4. Apply migrations and load the fictional demo data
npm --prefix backend run migrate
npm --prefix backend run seed          # use `-- --reset` to wipe and reseed (development only)

# 5. Run (three terminals)
npm --prefix backend run dev           # API on http://localhost:4000
npm --prefix backend run worker:dev    # email, quiz expiry and retention jobs
npm --prefix frontend run dev          # app on http://localhost:5173 (proxies /api to :4000)
```

### Demo accounts (fictional, development seed only)

All use the password from `SEED_PASSWORD` (default `CbidDemo!2026`). The people are fictional; the programmes,
programme areas, audiences and contact details follow CBID Institute.

| Role | Email |
| --- | --- |
| Administrator | `coordinator@cbid.example` |
| Trainer | `sana.mirza@cbid.example`, `farhan.qureshi@cbid.example`, `mehwish.baig@cbid.example` |
| Learner | `amina.khan@cbid.example` (has a certificate to view), `bilal.ahmed@cbid.example`, `zara.malik@cbid.example`, and 7 more |

Seeded courses: DET101 Disability Equality Training, IBT201 Inclusive Business Training, IET201 Inclusive
Education Training, ILT101 Independent Living Training (published); CBW101 Capacity Building Workshop for OPDs and
CT301 Customized Training: Inclusive Public Services (drafts for next term); DET090 Disability Equality Awareness
Session (archived, with an issued certificate).

Internally the roles keep the keys `student` and `teacher` (database, API and permissions). Everything people see
says **Learner** and **Trainer**.

Without `SMTP_URL`, development emails (password resets, invitations) are written to
`backend/storage/dev-mail/` so you can open the links. In production the worker refuses to start without SMTP.

### Creating a real administrator

Administrator accounts are never created or promoted through the web API. Create one on the server:

```bash
DATABASE_OWNER_URL=... npm --prefix backend run create-admin -- --email coordinator@cbidnetwork.org --name "Programme Coordinator"
# compiled build: node dist/scripts/create-admin.js --email ... --name ...
```

## Tests and quality checks

| Command | What it runs |
| --- | --- |
| `npm --prefix backend test` | 110 unit + integration tests against a dedicated `cbid_lms_test` database (schema rebuilt from migrations each run) |
| `npm --prefix frontend test` | 28 unit/component tests (jsdom) |
| `npm --prefix frontend run build && npm --prefix frontend run e2e` | 18 Playwright tests against `cbid_lms_e2e` (migrated and reseeded each run), including axe-core accessibility checks on 18 pages |
| `npm run lint`, `npm run typecheck` | ESLint (incl. jsx-a11y) and TypeScript for both packages |

The test databases must exist first (same bootstrap, different names):

```bash
psql -U postgres -v owner_pw="'owner_dev_pw'" -v app_pw="'app_dev_pw'" -v db=cbid_lms_test -f database/bootstrap.sql
psql -U postgres -v owner_pw="'owner_dev_pw'" -v app_pw="'app_dev_pw'" -v db=cbid_lms_e2e  -f database/bootstrap.sql
```

The suites default to the development passwords above. Override them with `TEST_DATABASE_URL` / `TEST_DATABASE_OWNER_URL`
and `E2E_DATABASE_URL` / `E2E_DATABASE_OWNER_URL`. They refuse to run against databases whose names do not end in `_test` / `_e2e`.
On a new machine, run `npx playwright install chromium` once in `frontend/`.

## Production deployment

1. Build: `npm --prefix frontend run build && npm --prefix backend run build`.
2. Run `node dist/scripts/migrate.js` (owner credentials) on each release, before starting the new API.
3. Run the API (`node dist/index.js`) with `SERVE_STATIC_DIR` pointing at `frontend/dist`. This makes a
   single origin, so cookies, CSRF and CSP stay simple. Run at least one worker (`node dist/worker.js`).
4. Put a TLS-terminating reverse proxy in front. Set `NODE_ENV=production`, `COOKIE_SECURE=true`,
   `APP_ORIGIN=https://…` and `TRUST_PROXY=true`. The API refuses to start with insecure settings in production.
5. Provide `SMTP_URL` and, for more than one API instance, `REDIS_URL` (shared rate limits). If you send from a
   `cbidnetwork.org` address (`MAIL_FROM`), add your SMTP provider to the domain's SPF and DKIM records first.
6. Sign in as an administrator and check **Settings & status**: institute name, support email, phone, address and
   website are shown on the sign-in page, in every email and on certificates.
7. Store uploads (`UPLOAD_DIR`) on a persistent volume that is included in backups.
8. Suggested address: a subdomain such as `learn.cbidnetwork.org`. Certificates print their verification address
   from the site's own origin, so issue real certificates only once the final domain is in place.

**Docker:** `cp .env.example .env`, replace every `CHANGE_ME`, then `docker compose up --build`. This starts
PostgreSQL, Redis, a one-shot migration job, the API on port 4000 and the worker. The Docker files were written
but **not built or run in the development environment** (no Docker daemon was available), so treat them as a starting point to verify.

**Backups and recovery:** use `pg_dump -Fc` daily (or managed PITR) and back up the uploads volume. Restore into a
fresh database created with `database/bootstrap.sql`, then run migrations. Test restores regularly. Audit logs are
kept for 2 years and notifications for 180 days by default (`RETENTION_*` variables).

## Troubleshooting

- **403 "Cross-origin request blocked":** `APP_ORIGIN` must exactly match the address in the browser.
- **Every query returns nothing:** `DATABASE_URL` must use `cbid_app`. RLS requires an identity, so ad-hoc
  `psql` sessions as `cbid_app` see no rows unless you `SELECT set_config('app.user_id', '<uuid>', true)` inside a transaction.
- **"Migration … was modified after being applied":** never edit applied migrations; add a new numbered file.
- **Changing the logos:** replace `frontend/src/assets/cbid-institute-logo.webp` and `cbid-network-logo.webp`
  (same names, transparent background). The bundled files are the 225 px high versions published on cbidnetwork.org;
  for print-quality certificates use original artwork (SVG, or PNG at least 600 px high).
=======
# cbid
cbid institute lms
>>>>>>> origin/main
