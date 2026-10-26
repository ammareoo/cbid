import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asDbUser, setupContext, teardown, type Ctx } from '../helpers.js';

/**
 * These tests bypass the HTTP layer entirely and talk to PostgreSQL as the API role (cbid_app).
 * They prove the database itself enforces the boundaries, independent of backend code.
 */
let ctx: Ctx;
beforeAll(async () => { ctx = await setupContext(); });
afterAll(async () => { await teardown(ctx); });

const count = async (userId: string | null, sql: string, params: unknown[] = []) =>
  (await asDbUser<{ n: number }>(ctx.appPool, userId, `SELECT count(*)::int AS n FROM (${sql}) x`, params))[0]!.n;

describe('anonymous connections', () => {
  it('see nothing private', async () => {
    for (const t of ['users', 'courses', 'enrollments', 'submissions', 'grades', 'announcements', 'notifications', 'audit_logs', 'certificates']) {
      expect(await count(null, `SELECT 1 FROM ${t}`)).toBe(0);
    }
  });
  it('cannot read sessions, reset tokens or the email queue at all', async () => {
    for (const t of ['sessions', 'password_reset_tokens', 'email_outbox']) {
      await expect(asDbUser(ctx.appPool, null, `SELECT * FROM ${t}`)).rejects.toThrow(/permission denied/);
    }
  });
  it('cannot read password hashes even when signed in', async () => {
    await expect(asDbUser(ctx.appPool, ctx.ids.admin, 'SELECT password_hash FROM users')).rejects.toThrow(/permission denied/);
  });
});

describe('student boundaries', () => {
  it('sees only their own submissions and released grades', async () => {
    const { students, assignments } = ctx.ids;
    expect(await count(students.amina, 'SELECT 1 FROM submissions WHERE student_id <> $1', [students.amina])).toBe(0);
    expect(await count(students.amina, 'SELECT 1 FROM submissions')).toBeGreaterThan(0);
    expect(await count(students.bilal, 'SELECT 1 FROM grades WHERE assignment_id = $1', [assignments.reflection])).toBe(0); // unreleased
    expect(await count(students.amina, 'SELECT 1 FROM grades WHERE student_id <> $1', [students.amina])).toBe(0);
  });

  it('cannot see quiz answer keys or questions before starting an attempt', async () => {
    expect(await count(ctx.ids.students.amina, 'SELECT 1 FROM quiz_answer_keys')).toBe(0);
    expect(await count(ctx.ids.students.amina, 'SELECT 1 FROM quiz_questions')).toBe(0);
  });

  it('cannot see other students\' profiles but can see their teachers', async () => {
    const visible = await asDbUser<{ role: string }>(ctx.appPool, ctx.ids.students.amina, 'SELECT role FROM users');
    expect(visible.filter((u) => u.role === 'student')).toHaveLength(1);
    expect(visible.some((u) => u.role === 'teacher')).toBe(true);
  });

  it('cannot write a grade, change a submission or escalate their role', async () => {
    const { students, assignments } = ctx.ids;
    await expect(asDbUser(ctx.appPool, students.amina,
      'INSERT INTO grades (assignment_id, student_id, score) VALUES ($1, $2, 20)', [assignments.barrierReport, students.amina]))
      .rejects.toThrow(/row-level security/);
    const updated = await asDbUser(ctx.appPool, students.amina, 'UPDATE grades SET score = 20 WHERE student_id = $1 RETURNING 1', [students.amina]);
    expect(updated).toHaveLength(0);
    await expect(asDbUser(ctx.appPool, students.amina, "UPDATE submissions SET body = 'edited'")).rejects.toThrow(/permission denied/);
    await expect(asDbUser(ctx.appPool, students.amina, "UPDATE users SET role = 'admin' WHERE id = $1", [students.amina]))
      .rejects.toThrow(/Only administrators/);
  });

  it('cannot submit on behalf of another student', async () => {
    const { students, assignments } = ctx.ids;
    await expect(asDbUser(ctx.appPool, students.amina,
      "INSERT INTO submissions (assignment_id, student_id, attempt, body) VALUES ($1, $2, 1, 'forged')", [assignments.barrierReport, students.bilal]))
      .rejects.toThrow(/row-level security|own work/);
  });

  it('cannot enrol in a course that is closed for enrolment', async () => {
    await expect(asDbUser(ctx.appPool, ctx.ids.students.kamran,
      'INSERT INTO enrollments (course_id, user_id) VALUES ($1, $2)', [ctx.ids.courses.ibt, ctx.ids.students.kamran]))
      .rejects.toThrow(/row-level security|not open/);
  });

  it('cannot read the audit log', async () => {
    expect(await count(ctx.ids.students.amina, 'SELECT 1 FROM audit_logs')).toBe(0);
  });
});

describe('teacher boundaries', () => {
  it('sees submissions only for courses they teach', async () => {
    const farhanSees = await asDbUser<{ course_id: string }>(ctx.appPool, ctx.ids.teachers.farhan,
      'SELECT a.course_id FROM submissions s JOIN assignments a ON a.id = s.assignment_id');
    expect(farhanSees.every((r) => r.course_id === ctx.ids.courses.ibt)).toBe(true);
    expect(farhanSees.length).toBeGreaterThan(0);
  });

  it('cannot grade outside their courses', async () => {
    await expect(asDbUser(ctx.appPool, ctx.ids.teachers.farhan,
      'INSERT INTO grades (assignment_id, student_id, score) VALUES ($1, $2, 10)', [ctx.ids.assignments.barrierReport, ctx.ids.students.amina]))
      .rejects.toThrow(/row-level security/);
  });

  it('cannot publish a course or change enrolment settings', async () => {
    await expect(asDbUser(ctx.appPool, ctx.ids.teachers.farhan, "UPDATE courses SET status = 'published' WHERE id = $1", [ctx.ids.courses.cbw]))
      .rejects.toThrow(/Only administrators/);
  });

  it('can read answer keys for their own quizzes only', async () => {
    expect(await count(ctx.ids.teachers.sana, 'SELECT 1 FROM quiz_answer_keys')).toBe(4);
    expect(await count(ctx.ids.teachers.mehwish, 'SELECT 1 FROM quiz_answer_keys')).toBe(0);
  });
});

describe('administrator boundaries', () => {
  it('can read the audit log', async () => {
    await asDbUser(ctx.appPool, ctx.ids.admin, "SELECT app.audit('test.event', NULL, NULL)");
    expect(await count(ctx.ids.admin, 'SELECT 1 FROM audit_logs')).toBeGreaterThan(0);
  });

  it('cannot alter or delete audit records', async () => {
    await expect(asDbUser(ctx.appPool, ctx.ids.admin, 'DELETE FROM audit_logs')).rejects.toThrow(/permission denied/);
    await expect(asDbUser(ctx.appPool, ctx.ids.admin, "UPDATE audit_logs SET action = 'x.y'")).rejects.toThrow(/permission denied/);
  });

  it('cannot promote anyone to administrator or change their own role', async () => {
    await expect(asDbUser(ctx.appPool, ctx.ids.admin, "UPDATE users SET role = 'admin' WHERE id = $1", [ctx.ids.students.omar]))
      .rejects.toThrow(/system owner/);
    await expect(asDbUser(ctx.appPool, ctx.ids.admin, "UPDATE users SET status = 'deactivated' WHERE id = $1", [ctx.ids.admin]))
      .rejects.toThrow(/own role/);
  });

  it('a deactivated administrator loses every privilege immediately', async () => {
    await ctx.owner.query("UPDATE users SET status = 'deactivated' WHERE id = $1", [ctx.ids.admin]);
    try {
      expect(await count(ctx.ids.admin, 'SELECT 1 FROM audit_logs')).toBe(0);
      expect(await count(ctx.ids.admin, 'SELECT 1 FROM submissions')).toBe(0);
    } finally {
      await ctx.owner.query("UPDATE users SET status = 'active' WHERE id = $1", [ctx.ids.admin]);
    }
  });
});

describe('identity is transaction-scoped', () => {
  it('does not leak app.user_id across pooled connections', async () => {
    await asDbUser(ctx.appPool, ctx.ids.admin, 'SELECT 1');
    const rows = await asDbUser<{ uid: string | null }>(ctx.appPool, null, 'SELECT app.uid() AS uid');
    expect(rows[0]!.uid).toBeNull();
  });
});
