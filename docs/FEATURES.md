# Implemented features and known limitations

Every feature below works end to end: UI, API, database, authorisation and tests.

The interface calls the roles **Learner**, **Trainer** and **Administrator**. In code and in the database the keys
remain `student`, `teacher` and `admin`.

## CBID Institute identity

- CBID Institute and CBID Network PK Sindh logos, the institute's colours (navy, teal, green and orange from the
  logo) and DM Serif Text headings as on cbidnetwork.org. Body text stays in Atkinson Hyperlegible Next for legibility.
- Sign-in page with the institute's purpose, the route to a certificate, and the parent organisation's contact details.
- Footer on every page with the address, phone, email and website.
- Institute name, parent organisation, support email, phone, address and website are administrator settings. They
  feed the header, the sign-in page, emails and certificates, so a change needs no code.
- Programme areas and seed courses follow the six CBID Institute programmes. Each course states who it is for and
  how it is delivered (online, blended with onsite sessions, or onsite in Karachi).

## Learners

- Sign in, sign out, password recovery by email, change password, and invitation-based account setup.
- **Dashboard:**
  - Course cards with progress computed from completed published items.
  - A "Next up" panel of assignments and quizzes for the next 3 weeks, with done states.
  - Recent released feedback and the latest announcements.
- **Courses and content:**
  - Catalogue with search (title, code, topic or audience), a delivery-format filter and pagination, and self-enrolment into open courses (capacity enforced). Learners can withdraw.
  - Each course shows who it is for and how it is delivered.
  - Course overview with a "continue where you left off" link, then modules with reading pages (Markdown), external links and files.
  - Mark items complete, and move to the previous or next item.
- **Assignments:**
  - Submit text and/or a file (a validated upload). Multiple attempts with full history.
  - Late window clearly marked, with deadlines enforced on the server.
  - Released grade and feedback shown on the assignment.
- **Quizzes:**
  - Single choice, multiple choice and short answer, with an optional time limit and attempt limit.
  - Answers save automatically, and a countdown gives screen-reader announcements at 5 and 1 minutes.
  - Scored on the server, with per-question results after submission.
- Grades across all courses, and per course with released totals.
- **Certificates:** a list of certificates earned, and a printable certificate (A4 landscape, or save as PDF) with
  both logos, the serial number and the verification address. Learners are notified in the app and by email when
  one is issued, and can copy a verification link to share.
- **Communication:** announcements feed, notifications (unread count, mark read, filter), and an agenda calendar of deadlines, quiz closes and events.
- **Profile and settings:** preferred name and time zone (all dates shown in it), plus email notification preferences.
- **Display options:** text size, wider spacing, reduced motion, and light, dark or system theme.

## Trainers

- **Dashboard:** a "needs grading" queue across courses, deadline overview with submission counts, and course cards.
- **Course content:**
  - Edit the course description.
  - Create, edit, publish or hide, reorder (up/down buttons, keyboard-accessible) and delete modules and items.
  - Upload materials.
- **Assignments:** create and edit (due date, late cut-off, points, submission type, attempts), publish (learners are notified), and delete when unused.
- **Grading:**
  - A per-assignment queue with status, and each learner's attempts and files.
  - Score and feedback with an optimistic-concurrency guard.
  - Release individually or all at once. Learners are notified, and emailed if they opted in.
- **Quizzes:**
  - Builder with question types, answer keys and reorderable questions. Questions lock automatically after the first attempt.
  - Results per learner.
- Gradebook (learners × assignments, with released and unreleased grades distinguished), a class list with progress, submissions and grade percentages (sortable), and course announcements with optional notification.
- **Certificates tab:** each enrolled learner with progress, submissions, grade and certificate status. Issue a
  certificate (confirmation step), view it, or revoke it with a reason. Revoked certificates are listed separately.

## Administrators

- **Overview:** live counts, courses needing attention (no trainer, or full), and recent activity.
- **People:**
  - Search and filter by role and status, with pagination.
  - Create learners and trainers by invitation, and edit name, email, role and programme area.
  - Deactivate or reactivate (sessions revoked instantly) and send a reset link.
- **Courses:**
  - Search and filter, create (as draft), edit settings (including audience and delivery), publish, archive or restore, and delete drafts.
  - Assign and remove trainers and set the lead.
  - Enrol learners and change enrolment status.
  - Issue and revoke certificates for any course.
- Programme areas and terms, and institute-wide announcements to everyone.
- Audit log with filters.
- **Settings:** institute name, parent organisation, support email, phone, address, website, notice banner and self-enrolment switch. Also a system status page covering the database, Redis, worker heartbeat, email queue, sessions and database size.

## Public pages (no account needed)

- **Certificate verification** (`/verify`): enter a serial such as `CBID-2026-ABCD2345` to see whether the
  certificate is valid or revoked, who it was awarded to, the course and the date. Linked from the sign-in page.

## Platform

- PostgreSQL RLS on every table, guard triggers, trusted functions, versioned migrations with checksum verification, and a fictional development seed.
- Background worker for email delivery with retries, quiz expiry and retention clean-up.
- Strict CSP, CSRF protection, rate limiting (Redis-capable) and an audit log.
- Responsive layouts from 320 px phones to wide desktops, keyboard and screen-reader support, and WCAG 2.2 AA as the target (automated axe checks pass on key pages).

## Not implemented

These are deliberately out of scope for this release:

| Not included | Notes |
| --- | --- |
| Discussion forums | The schema and design are ready to add a `discussions` module. Announcements cover one-way communication for now. |
| Onsite assessment booking and adjustment requests | Assessment days are calendar events and adjustments are requested through the trainer. A booking module (sessions at the Karachi centre, seats, adjustments) is the obvious next feature. |
| Automatic completion rules and course prerequisites | Trainers issue certificates by judgement, with progress, submissions and grades shown beside each learner. Automatic rules (for example "all items complete and at least 60%") need an institute policy decision first. |
| Urdu and Sindhi interface | cbidnetwork.org offers English, Urdu and Sindhi through Google Translate. The platform is English only. A proper translation (with right-to-left layout for Urdu and Sindhi) needs translated text from the institute; machine translation was not added because it would send page content to Google. |
| Organisation accounts for Customized Training | Staff of a client organisation are enrolled individually. Grouping them under the organisation (reports, seat purchases) needs a small schema addition. |
| CSV / PDF exports | The gradebook is on screen only. Export is a background-job candidate. |
| Multi-factor authentication and SSO (SAML/OIDC) | Recommended before production for administrators. |
| Rubrics, peer review, inline annotation of files | Grading is score plus written feedback. |
| Rich-text (WYSIWYG) editor | Content uses Markdown with live sanitised rendering. |
| Bulk user import (CSV) | Users are created one by one with invitations. Useful for workshop cohorts. |
| Per-learner quiz time extensions | Trainers can set longer limits for the whole quiz. Individual extensions need a small schema addition. |
| Antivirus scanning, object storage | See SECURITY.md. |

## Known limitations and unverified areas

- **Docker:** the `Dockerfile` and `docker-compose.yml` were written but not built or run here, because no Docker daemon was available.
- **Email:** sending was verified with the development file transport only. SMTP is configured through `SMTP_URL` and has not been tested against a real mail server.
- **Redis rate limiting:** exercised in development against a local Redis (the API connects and reports its status). The automated tests use the in-memory store.
- **Assistive technology:** automated accessibility checks (axe-core) pass on the audited pages. Full manual testing with screen readers (NVDA, JAWS, VoiceOver) and with disabled users has not been done and is recommended.
- **Logos:** the bundled logo files are the 225 px high versions published on cbidnetwork.org. They are sharp on screen and acceptable in print; original artwork would print more crisply (see README).
- **Brand colours and fonts** were read from the institute logo and the website's stylesheet; there is no written brand guide to check them against.
- **Load:** performance was checked informally only (dashboard API responses of about 10–40 ms on seed data). No load test was run.
