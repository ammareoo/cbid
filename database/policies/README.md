# Row-Level Security policies

Policies live in the migrations so they are versioned and applied with the schema:

- `../migrations/0002_security.sql`: identity helpers (`app.uid()`, `app.my_role()`, `app.course_staff()` …), guard triggers, trusted `SECURITY DEFINER` functions, grants, and every `CREATE POLICY`.
- `../migrations/0005_policy_fixes.sql`: SELECT policies rewritten so `INSERT … RETURNING` works for the creator, and the quiz-answer guard switched to invoker rights. Both were found by the integration tests.
- `../migrations/0006_quiz_summary.sql`: question totals for learners without exposing questions.

The access matrix and trust model are documented in [`docs/SECURITY.md`](../../docs/SECURITY.md). The policies are
tested directly against PostgreSQL in [`backend/tests/integration/rls.test.ts`](../../backend/tests/integration/rls.test.ts).

To change a policy, add a new numbered migration. Never edit an applied one; the runner rejects changed checksums.
