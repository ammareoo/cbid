# Architecture

## Decisions at a glance

| Decision | Choice | Why |
| --- | --- | --- |
| Starting point | New application, reusing the structure of the earlier static prototype | The prototype was one static HTML page with no backend, data or auth, so there was nothing to extend. Its "wayfinding sign" motif and accessible-first content carried over. |
| Identity | CBID Institute (CBID Network PK Sindh), from cbidnetwork.org | Logos, colours from the institute logo, DM Serif Text headings as on the website, the six programmes, audiences and contact details. See CBID-ALIGNMENT.md. |
| Role names | Keys `student`/`teacher` kept; shown as Learner/Trainer | The institute runs trainings and workshops. Renaming keys would touch every policy, migration and test for no security or functional gain. |
| Backend | Node.js 22 + TypeScript + Fastify 5 | Chosen by the product owner (matches the earlier CBID Institute decision). Fastify gives schema-friendly routing, hooks for auth/CSRF, and mature security plugins. |
| Data access | `pg` with hand-written parameterised SQL, no ORM | RLS, guard triggers and `SECURITY DEFINER` functions are central. Plain SQL keeps them visible and testable, with no ORM magic bypassing them. |
| Database | Self-hosted PostgreSQL 16 | Chosen by the product owner. Portable to any managed Postgres (including Supabase) because migrations are plain SQL. |
| Authentication | Local accounts, Argon2id, opaque server-side sessions in an HttpOnly cookie | Revocable sessions (logout, deactivation, password change) and no tokens in JavaScript-readable storage. |
| Authorisation | Three layers: route permission → service resource check → PostgreSQL RLS + triggers | Each layer stops a different class of bug. See SECURITY.md. |
| Frontend | React + Vite SPA, served from the API origin in production | One origin keeps cookies (`SameSite=Lax`, `__Host-`), CSRF and CSP strict and simple. |
| Background jobs | One worker process on the owner connection with a polling loop and advisory locks | Enough for email, quiz expiry and retention, with no extra infrastructure. The `email_outbox` table makes email durable and retryable. |
| Cache | None for personalised data. Redis only for rate-limit counters | Grades, submissions and permissions must never be served stale or shared between users. |

## Request lifecycle (API)

```
HTTP request
 ├─ helmet (CSP, HSTS, nosniff, frame-ancestors none), CORS allow-list
 ├─ auth hook
 │   ├─ unsafe method? → Origin must equal APP_ORIGIN; Sec-Fetch-Site cross-site rejected
 │   ├─ session cookie → SHA-256 → app.auth_resolve_session() (idle + absolute expiry, sliding idle window)
 │   └─ unsafe method + signed in → X-CSRF-Token must match the session's token (constant-time)
 ├─ rate limit (global 600/min per user or IP; stricter per route; Redis-backed when configured)
 ├─ route preHandler: requireAuth / requirePermission('grades.manage') …   ← role capability (deny by default)
 ├─ handler: Zod-parse params/query/body (strict objects → no mass assignment)
 └─ req.db(tx => service(tx, …))
       BEGIN; set_config('app.user_id', <session user>, true)          ← transaction-local identity
       service: resource checks (courseAccess / requireStaff → 404 if not visible)
       SQL as cbid_app → RLS policies + guard triggers enforce again
       audit(tx, …) in the same transaction
       COMMIT
```

Errors are mapped centrally. Custom SQLSTATEs (`CB403`, `CB404`, `CB409`, `CB422`) raised by the database
become HTTP status codes with the database's authored message. Constraint and RLS errors become generic messages,
and anything unknown is a logged 500 with no internals in the response.

## Data model

```
roles ─┐
departments ─┐       terms
             ▼         ▼
users ◄── course_teachers ──► courses ◄── enrollments ──► users
  │                             │
  │                             ├── modules ── module_items ── item_completions (per user)
  │                             │                    └── files (material)
  │                             ├── assignments ── submissions (attempts, client_token) ── files (submission)
  │                             │                └─ grades (one per student, versioned, released_at)
  │                             ├── quizzes ── quiz_questions ── quiz_options
  │                             │                     └── quiz_answer_keys (hidden from students)
  │                             │            └─ quiz_attempts ── quiz_answers
  │                             ├── certificates (serial, name/title snapshot, revoked_at; written by trusted functions)
  │                             ├── announcements (course_id NULL = institute-wide)
  │                             └── calendar_events (course_id NULL = academic calendar)
  ├── sessions, password_reset_tokens (hashed tokens, expiring)
  ├── notifications, notification_preferences
  └── audit_logs (append-only for the API)
system_settings · email_outbox · worker_heartbeats · schema_migrations
```

Key integrity rules enforced in the database:

- Unique enrolment per (course, user), unique teaching assignment, unique course code per term.
- One grade per (assignment, student) with `score ≤ points_possible`. `version` increments on every update (optimistic concurrency).
- Submission attempt numbers, lateness and timestamps are set by trigger; the deadline (`late_until` or `due_at`) and `max_attempts` are enforced there too.
- At most one in-progress quiz attempt per student and quiz (partial unique index). Answers cannot change after the deadline or submission.
- Quiz questions, options and keys are frozen once any attempt exists.
- People and graded work are never hard-deleted (`ON DELETE RESTRICT`). Users are deactivated and courses archived. Only draft courses can be deleted.
- All timestamps are `timestamptz` and the API session runs in UTC. The UI converts to each user's time zone (default Asia/Karachi).

Indexes follow the actual query paths: enrolments by user and course, submissions by student, assignments by
(course, due date), partial indexes for unread notifications, open quiz attempts and pending email, and trigram
indexes for name, email and course-title search.

### Retention

| Data | Policy | Mechanism |
| --- | --- | --- |
| Sessions | Deleted at idle (60 min) or absolute (12 h) expiry | Lazily on use + `app.purge_expired` hourly |
| Password reset / invite tokens | Single use; removed 1 day after expiry or use | Worker |
| Notifications | 180 days | Worker (`RETENTION_NOTIFICATIONS_DAYS`) |
| Sent or failed email | 30 days | Worker (`RETENTION_EMAIL_DAYS`) |
| Audit logs | 2 years | Worker (`RETENTION_AUDIT_DAYS`, minimum 90) |
| Rate-limit counters | Window TTL | Redis key TTL / in-memory LRU |
| Academic records | Kept; deactivate or archive instead of delete | FK `RESTRICT` |

## API reference (all under `/api`, JSON, cookie session + `X-CSRF-Token` for writes)

| Area | Endpoints |
| --- | --- |
| Auth | `POST auth/login` · `POST auth/logout` · `GET auth/session` · `POST auth/password/forgot` · `POST auth/password/reset` · `POST auth/password/change` |
| Me | `GET/PATCH me/profile` · `GET/PUT me/notification-preferences` · `GET me/dashboard` · `GET me/grades` |
| Courses | `GET courses?scope=mine\|catalogue[&mode=online\|blended\|onsite]` · `GET/PATCH courses/:id` · `POST courses/:id/enroll` · `POST courses/:id/withdraw` · `GET courses/:id/students` · `GET courses/:id/gradebook` · `GET courses/:id/my-grades` |
| Content | `GET/POST courses/:id/modules` · `PATCH/DELETE modules/:id` · `POST modules/:id/move` · `POST modules/:id/items` · `GET/PATCH/DELETE items/:id` · `POST items/:id/move` · `POST/DELETE items/:id/complete` |
| Assignments | `GET/POST courses/:id/assignments` · `GET/PATCH/DELETE assignments/:id` · `POST assignments/:id/submissions` · `GET assignments/:id/submissions[/:studentId]` · `PUT assignments/:id/grades/:studentId` · `POST assignments/:id/grades/release` |
| Quizzes | `GET/POST courses/:id/quizzes` · `GET/PATCH/DELETE quizzes/:id` · `GET quizzes/:id/results` · `POST quizzes/:id/attempts` · `GET attempts/:id` · `PUT attempts/:id/answers/:questionId` · `POST attempts/:id/submit` |
| Communication | `GET announcements` · `POST courses/:id/announcements` · `POST announcements` (institute-wide) · `DELETE announcements/:id` · `GET notifications` · `GET notifications/unread-count` · `POST notifications/:id/read` · `POST notifications/read-all` · `GET calendar?from&to` · `POST courses/:id/events` · `POST events` · `DELETE events/:id` |
| Files | `POST courses/:id/files?purpose=material\|submission` (multipart) · `GET files/:id` |
| Certificates | `GET certificates` (own) · `GET certificates/:id` · `GET/POST courses/:id/certificates` · `POST certificates/:id/revoke` · public: `GET verify/:serial` |
| Public | `GET branding` (institute name and contact details) · `GET health` |
| Admin | `GET admin/dashboard` · `GET admin/status` · `GET/POST admin/users` · `GET/PATCH admin/users/:id` · `POST admin/users/:id/send-reset` · `GET/POST admin/courses` · `GET/PATCH/DELETE admin/courses/:id` · `PUT/DELETE admin/courses/:id/teachers/:userId` · `POST admin/courses/:id/enrollments` · `PATCH admin/enrollments/:id` · `GET admin/people` · departments & terms CRUD · `GET admin/audit` · `GET/PUT admin/settings` |

Conventions:
- Lists are paginated as `{ items, page, pageSize ≤ 100, total, totalPages }`.
- Errors are returned as `{ error: { code, message, details? } }`.
- Validation errors are 400 with field paths.
- Resources you cannot see return 404 (not 403), so ids cannot be probed.
- Submissions accept a client `clientToken` (UUID) for idempotent retries.
- Grade updates accept `expectedVersion` and return 409 on concurrent edits.

## Frontend

- `src/api`: fetch client (CSRF header, typed `ApiError`, global 401 handling) and shared types.
- `src/auth`: session provider. The CSRF token lives in memory only. UI role guards are convenience only; the API decides.
- `src/layouts/AppShell`:
  - Role-specific sidebar navigation.
  - A drawer (native `<dialog>`) on small screens.
  - A skip link.
  - Focus moves to the new page heading after each navigation (not on first load).
- `src/components`:
  - The design-system primitives: fields with associated hints and errors, ErrorSummary, Dialog/ConfirmDialog (native `<dialog>`), toasts (live region), badges with text, QueryView (loading, error and empty states), and Markdown (marked + DOMPurify allow-list).
- `src/pages/{student,teacher,course,admin,shared,auth}`:
  - One component per page, lazy-loaded per route.
  - Course pages share `CourseLayout` (course header + section tabs) and adapt to the viewer's relationship to the course (staff, learner or visitor).
- Design tokens are in `src/styles/tokens.css` (light and dark themes):
  - Colours from the CBID Institute logo: navy `#0C3C60` (brand), teal `#247890`/`#1B6380` (links), green `#6CA848` and orange `#FC9024` (accent and focus halo). Every text pairing meets WCAG 2.2 AA.
  - Typefaces: DM Serif Text for display text (as on cbidnetwork.org, one weight only, never synthesised bold); Atkinson Hyperlegible Next for UI and body text instead of the website's Nunito, chosen for low-vision legibility.
  - Spacing on a 4 px scale.
  - A two-ring focus indicator (orange halo plus an ink ring) that stays visible on every surface.
  - Logos sit on a white plate in dark mode and on the dark sign-in panel so they stay legible.
  - Print stylesheet: a certificate prints alone on one A4 landscape page.
  - The "wayfinding sign" panel from the prototype is reused for the "Next up" and "Deadlines ahead" lists.

## Research notes (what informed the design)

Sources read during this build:
- cbidnetwork.org (home page and /cbid-institute): organisation, programmes, audiences, values, contact details; and its stylesheet and logos for colours and type (read in a browser with the owner's permission).
- OWASP Session Management Cheat Sheet, which informed the idle and absolute timeouts, rotation on login and privilege change, `__Host-` cookies and server-side revocation.
- OWASP CSRF Prevention Cheat Sheet, which informed the synchronizer token sent as a custom header, the Origin and Fetch-Metadata checks, and SameSite as defence in depth.
- OWASP Password Storage Cheat Sheet: Argon2id with m=19 MiB, t=2, p=1.
- PostgreSQL 16 Row Security documentation, covering owner and `BYPASSRLS` bypass, default deny, USING vs WITH CHECK, and `SECURITY DEFINER` caveats.
- Moodle's Grader report documentation, which informed the gradebook layout (students as rows, items as columns) and the hide-or-release concept.

LMS conventions applied from general product knowledge of Canvas, Blackboard Learn, Brightspace and Sakai. These product pages were not fetched in this session, and no layouts, branding or assets were copied:
- A "to do / coming up" panel on the student dashboard.
- Module-based content with completion tracking.
- A per-assignment grading queue with released versus unreleased grades.
- Course-scoped announcements alongside an institution-wide feed.
- An agenda-style calendar that merges deadlines and events.
