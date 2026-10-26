# Security model

The frontend is untrusted. Every rule that matters is enforced by the API **and** by PostgreSQL, so a bug in one
layer does not expose data. Everything listed under "Verified by tests" has an automated test that exercises both
the allowed and the denied path.

## Authentication

- **Passwords:** Argon2id (m=19 MiB, t=2, p=1, OWASP minimum).
- **Password policy:** 10–128 characters, common passwords rejected, and the email name must not appear in the password.
- **Sessions:**
  - Each session is a 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie. It uses the `__Host-` prefix and `Secure` in production.
  - Only the SHA-256 hash of the token is stored.
  - Sessions expire after 60 minutes idle (sliding) and 12 hours absolute, both enforced in the database.
- **Login:**
  - Any session presented at login is revoked, which prevents session fixation.
  - Failed sign-ins return one generic message, and Argon2 still runs for unknown emails so response timing does not reveal which accounts exist.
  - An account locks for 15 minutes after 5 failures.
  - Rate limits: 10 sign-in attempts per minute per client, and 5 recovery requests per 15 minutes.
- **Logout:** deletes the session server-side and sends `Clear-Site-Data`.
- **Password change:** requires the current password, revokes every session, and issues a new one.
- **Password recovery:**
  - The response is the same whether or not the account exists.
  - Reset tokens are random, stored hashed, single-use and expire after 30 minutes.
  - A successful reset revokes all sessions.
- **New accounts:** no password is ever set by an administrator. The person receives an invite link, which is a reset token valid for 72 hours.
- **Administrator accounts:** created only from the server (`npm run create-admin`), never through the API.

## CSRF and cross-origin

- **Synchronizer token:** each session has a CSRF token, returned by `/api/auth/session`. It is held in memory by the SPA, sent as `X-CSRF-Token`, and compared in constant time.
- **Origin checks:** state-changing requests must come from `APP_ORIGIN`. Requests with `Sec-Fetch-Site: cross-site` are rejected even when no Origin header is present.
- **CORS:** a single allowed origin, credentials enabled, and an explicit method and header list.
- **No state changes over GET.**
- **Public endpoints** (no session): `GET /api/branding` (60 requests a minute) and `GET /api/verify/:serial`
  (20 a minute per client, strict serial format). Serials have 8 random characters from a 32-symbol alphabet
  (about 10^12 values per year), so guessing a valid serial at that rate is not practical.

## Authorisation (three layers)

1. **Role capability**, in `backend/src/permissions/policy.ts`:
   - The matrix of roles and permissions is deny-by-default.
   - Routes declare `requirePermission('grades.manage')` and similar.
   - To add a role: insert it into `roles` with a rank, add it to the matrix, then decide which RLS helpers should recognise it.
2. **Resource checks in services:**
   - `courseAccess()`, `requireStaff()` and `requireVisible()` load the course through RLS.
   - They return 404 when the caller has no relationship to it.
   - Archived courses are read-only for teachers.
3. **PostgreSQL:**
   - The API connects as `cbid_app`: not an owner, `NOBYPASSRLS`, with column-level grants. For example, it cannot read `users.password_hash`, cannot update `quiz_answers.is_correct`, and cannot touch `sessions` at all.
   - Each request sets `app.user_id` transaction-locally from the validated session.
   - Helper functions derive the role from the `users` table, never from the client.
   - A deactivated account loses every privilege immediately.

### Row-Level Security matrix (`database/migrations/0002_security.sql`, `0005_policy_fixes.sql`)

Role keys are shown as Learner (`student`) and Trainer (`teacher`) in the interface.

| Table | Learner (`student`) | Trainer (`teacher`, own courses) | Administrator | Anonymous |
| --- | --- | --- | --- | --- |
| users | self + their teachers | self, co-teachers, their students | all | – |
| courses | published + enrolled (published/archived) | taught (edit content only; no publish/code/term/enrolment) | all | – |
| enrollments | own (insert only via self-enrol rules; withdraw only) | read roster | all | – |
| modules / module_items | published items of enrolled courses | full (unless archived) | full | – |
| assignments | published, enrolled | full | full | – |
| submissions | own; insert own only (trigger: deadline, attempts, file ownership) | read | read | – |
| grades | own **released** only | read/write | read/write | – |
| quiz_questions / options | only after starting an attempt | full | full | – |
| quiz_answer_keys | **never** | own quizzes | all | – |
| quiz_attempts | own (created/scored only by trusted functions) | read | read | – |
| quiz_answers | own, while the attempt is open | read | read | – |
| files | own; materials visible through a published item | course files | all | – |
| announcements / calendar | institute-wide + enrolled courses | + write in own courses | + institute-wide write | – |
| notifications / preferences | own | own | own | – |
| certificates | own (read only) | read for own courses; issue/revoke via trusted functions | read all; issue/revoke via trusted functions | verify by exact serial only (trusted function) |
| audit_logs | – | – | read only (no update/delete grant) | – |
| sessions, reset tokens, email_outbox | no access (trusted functions only) | – | – | – |

**Trusted functions** (`SECURITY DEFINER`, owned by `cbid_owner`, `search_path` pinned):
- Authentication: session create, resolve and revoke, plus the reset functions.
- Quiz attempts: `start_quiz_attempt` checks eligibility, the window, attempt limits and the deadline. `submit_quiz_attempt` scores against the hidden keys.
- Notification fan-out, which checks that the caller teaches the course.
- `audit`: the actor is always `app.uid()`.
- Aggregate counts that are safe to share (seats taken, quiz question totals).
- Certificates (0007): `issue_certificate` checks that the caller is the course's trainer or an administrator, that
  the course is not a draft, that the learner is enrolled, and that no valid certificate exists; it generates the
  serial, snapshots the name and course title, and notifies the learner. `revoke_certificate` requires a reason and
  answers "not found" to anyone who is not course staff. `verify_certificate` returns only the serial, name, course,
  issue date and validity, never ids, emails or the revocation reason.
- `public_settings`: the institute's public contact details only (whitelisted keys), for the sign-in page and emails.

**Guard triggers** cover what RLS cannot express:
- Privilege escalation: no self role or status change, no granting or editing administrators, and role changes blocked while teaching assignments or active enrolments exist.
- Course publication and structure are admin-only.
- Deadlines and attempts.
- Grade bounds and grader identity.
- Quiz structure is frozen after the first attempt.
- Enrolment capacity uses a row lock to prevent races.

**Bypass paths and how they are handled:**
- `cbid_owner` bypasses RLS as table owner. It is used only by migrations, the seed (refuses `NODE_ENV=production`), the admin CLI and the worker. The worker takes no user input.
- Trusted functions are callable by `cbid_app` but check `app.uid()` themselves.
- `app.user_id` is set only by the API from a validated session. A compromised API process could set any identity, so the database layer protects against bugs, not against a fully compromised server.

## Input, output and files

- **Validation:**
  - Every request body, query and param goes through a strict Zod schema. Unknown fields are rejected (400), which prevents mass assignment.
  - Lengths are bounded, and the database repeats the bounds as CHECK constraints.
- **SQL:** queries are parameterised only. Dynamic fragments come from server-side allow-lists, and LIKE wildcards are escaped.
- **Rich text:**
  - Stored as Markdown and rendered with `marked`, then sanitised with DOMPurify against a strict tag and attribute allow-list.
  - `javascript:` and `data:` URLs are dropped, and external links get `rel="noopener noreferrer"`.
  - Links stored in content must be `https://` (checked in the API and in the database).
- **Uploads:**
  - The course relationship is checked *before* any bytes are accepted.
  - Limits: one file, 25 MB (configurable, at most 50), counted while streaming.
  - Type comes from magic bytes, and the extension must agree. Text files must be valid UTF-8. Purposes have separate allow-lists (no HTML, SVG or executables).
  - Files are stored under random keys outside the web root, with a SHA-256 recorded.
- **Downloads:**
  - Authorised per file by RLS.
  - Served with `Content-Disposition` (RFC 5987, sanitised), `nosniff`, `CSP: sandbox`, and `Cache-Control: private, no-store`.
- **Headers:**
  - Strict CSP: `script-src 'self'`, `style-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`.
  - HSTS in production, `Referrer-Policy`, and `no-store` on every API response.
- **Errors:** internals are never returned. The logger redacts cookies and CSRF headers.

## Operations

- **Secrets** come only from the environment, and `.env` is git-ignored. The API refuses to start in production if any of these hold:
  - an insecure cookie setting
  - a non-HTTPS origin
  - development database passwords
- **Audit log:** privileged and security events are written in the same transaction as the change. These include:
  - sign-in, sign-out and failed sign-ins
  - password events
  - people, role and status changes
  - course, publication, teacher and enrolment changes
  - grades and releases
  - submissions, quiz attempts, settings and file uploads
- **Rate limits** are in-memory by default and Redis-backed with `REDIS_URL`. Run Redis when there is more than one API instance.
- **Dependencies:** `npm audit` reported 0 vulnerabilities for both packages at build time. Re-run it in CI.

## Verified by tests

`backend/tests/integration`:
- `auth.test.ts`: cookie flags, generic errors, lockout, logout revocation, CSRF, origin and Fetch-Metadata checks, headers, the reset flow (single use, revocation), and password change with rotation.
- `ratelimit.test.ts`: production limits for sign-in and recovery.
- `authorization.test.ts`: IDOR and BOLA cases (submissions, grades, rosters, other courses, drafts), mass assignment, teacher scope, admin privilege boundaries, session revocation on deactivation, and malformed ids.
- `rls.test.ts`: talks to PostgreSQL directly as `cbid_app`. Covers the anonymous, student, teacher, administrator and deactivated-administrator identities, and that identity does not leak across pooled connections.
- `certificates.test.ts`: who may issue and revoke (trainer of the course, administrator; not learners or other
  trainers), no direct writes by the API role, learners see only their own certificates, public verification
  without identifiers, revocation, and administrator-only audience and delivery mode.
- `files.test.ts`: magic bytes, disguised executables, size limit, per-file download authorisation, and material visibility.
- `workflows.test.ts` and `jobs.test.ts`: deadlines, attempts, idempotency, optimistic concurrency, quiz scoring and key hiding, capacity, retention, and the email retry backoff.

`frontend/tests/e2e/security.spec.ts` repeats the critical denials through a real browser. `accessibility.spec.ts` runs axe-core (WCAG 2.2 AA tags) on key pages.

## Known limitations

- **No multi-factor authentication.** This is recommended for administrators before production.
- **No antivirus scanning of uploads.** Integrate ClamAV or a scanning service if staff open student files on unmanaged machines.
- **Local-disk file storage.** Object storage with signed URLs would be needed for multiple API hosts.
- **No external penetration test** has been performed.
