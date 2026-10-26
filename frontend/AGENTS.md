# Repository Guidelines
Whatever action you can do yourself, do it. this includes starting apps and performing verification
## Project Structure & Module Organization

This repository is a TypeScript monorepo for the CBID Institute LMS:

- `backend/` contains the Fastify API, background worker, database access, scripts, and Vitest tests. Feature code lives under `backend/src/modules/`; shared security and infrastructure live under `backend/src/lib/`, `backend/src/db/`, and `backend/src/permissions/`.
- `frontend/` is the React/Vite SPA. Pages are grouped under `frontend/src/pages/{auth,public,shared,student,teacher,course,admin}`; reusable UI belongs in `frontend/src/components/`.
- `database/` contains bootstrap SQL and numbered PostgreSQL migrations, including RLS policies and triggers. Never edit an applied migration; add the next numbered migration.
- `docs/` contains architecture, security, deployment, feature, and screenshot documentation.

## Build, Test, and Development Commands

Install dependencies with `npm run install:all` (or the package-specific install commands). Run the API, worker, and web app in separate terminals with `npm run dev:api`, `npm run dev:worker`, and `npm run dev:web`. Apply schema and demo data with `npm run migrate` and `npm run seed`.

Before submitting changes, run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Frontend end-to-end tests use `npm run test:e2e`; they require the `_e2e` database and Playwright Chromium. Backend integration tests require a `_test` database. See `README.md` for bootstrap commands and environment variables.

## Coding Style & Naming Conventions

Use TypeScript with each package's ESLint configuration; there is no separate formatter. Use two-space indentation, semicolons, and single quotes. Use `PascalCase` for React components, `camelCase` for functions and variables, and descriptive filenames such as `CourseDetail.tsx` and `courses.service.ts`. Keep SQL parameterized, validate inputs with strict Zod schemas, and preserve the route → service → RLS authorization layers.

## Testing Guidelines

Name unit and integration files `*.test.ts`/`*.test.tsx`; Playwright scenarios use `*.spec.ts`. Add tests for both allowed and denied authorization paths, especially when changing routes, services, or migrations. Maintain accessibility coverage for new UI with the existing Testing Library and axe-core/Playwright suites.

## Commit & Pull Request Guidelines

This checkout does not include Git history, so follow a concise imperative convention (for example, `Add quiz attempt expiry migration`). PRs should explain the behavior change, list migrations/configuration changes, and include tests run. Include screenshots for visible UI changes and call out any security, RLS, or deployment impact.

## Security & Configuration

Keep secrets in environment files, never commit `.env` or credentials, and use `.env.example` as the template. Development seed data is fictional only. Treat RLS, CSRF, strict validation, parameterized SQL, and audit logging as required behavior; update `docs/SECURITY.md` when security behavior changes.
