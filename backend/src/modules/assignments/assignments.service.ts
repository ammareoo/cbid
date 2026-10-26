import type { Tx } from '../../db/pool.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import type { AuthContext } from '../../types.js';
import { requireStaff, requireVisible } from '../courses/courses.service.js';

export interface AssignmentInput {
  title: string;
  instructions?: string;
  dueAt: string;
  lateUntil?: string | null;
  pointsPossible: number;
  submissionType?: 'text' | 'file' | 'text_or_file';
  maxAttempts?: number;
  status?: 'draft' | 'published';
}

const cols = `a.id, a.course_id AS "courseId", a.title, a.instructions, a.due_at AS "dueAt", a.late_until AS "lateUntil",
  a.points_possible AS "pointsPossible", a.submission_type AS "submissionType", a.max_attempts AS "maxAttempts",
  a.status, a.published_at AS "publishedAt"`;

/** Pure rule used by the UI and tests; the database trigger enforces the same rule authoritatively. */
export function submissionWindow(a: { dueAt: string | Date; lateUntil?: string | Date | null }, now = new Date()) {
  const due = new Date(a.dueAt);
  const close = a.lateUntil ? new Date(a.lateUntil) : due;
  if (now <= due) return { open: true, late: false };
  if (now <= close) return { open: true, late: true };
  return { open: false, late: true };
}

function checkDates(input: { dueAt?: string; lateUntil?: string | null }) {
  if (input.dueAt && input.lateUntil && new Date(input.lateUntil) <= new Date(input.dueAt)) {
    throw unprocessable('The late-submission cut-off must be after the due date');
  }
}

async function assignmentCourse(tx: Tx, id: string) {
  const r = await tx.maybeOne<{ course_id: string; title: string; status: string }>(
    'SELECT course_id, title, status FROM assignments WHERE id = $1', [id]);
  if (!r) throw notFound('Assignment');
  return r;
}

export async function listAssignments(tx: Tx, courseId: string, auth: AuthContext) {
  const access = await requireVisible(tx, courseId);
  if (access.isStaff) {
    const items = await tx.query(
      `SELECT ${cols},
              (SELECT count(DISTINCT s.student_id) FROM submissions s WHERE s.assignment_id = a.id)::int AS "submittedCount",
              (SELECT count(*) FROM grades g WHERE g.assignment_id = a.id)::int AS "gradedCount",
              app.active_enrollment_count(a.course_id) AS "studentCount"
         FROM assignments a WHERE a.course_id = $1 ORDER BY a.due_at, a.title`, [courseId]);
    return { items, isStaff: true, writable: access.writable };
  }
  const items = await tx.query(
    `SELECT ${cols},
            (SELECT count(*) FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = $2)::int AS "attemptsUsed",
            (SELECT max(s.submitted_at) FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = $2) AS "lastSubmittedAt",
            g.score, g.released_at AS "gradeReleasedAt"
       FROM assignments a
       LEFT JOIN grades g ON g.assignment_id = a.id AND g.student_id = $2
      WHERE a.course_id = $1 AND a.status = 'published'
      ORDER BY a.due_at, a.title`, [courseId, auth.userId]);
  return { items, isStaff: false, writable: false };
}

async function announceIfPublished(tx: Tx, courseId: string, a: { id: string; title: string; status: string; dueAt: string | Date }) {
  if (a.status !== 'published') return;
  await tx.query('SELECT app.notify_course($1, $2, $3, $4, $5)', [
    courseId, 'assignment', `New assignment: ${a.title}`.slice(0, 200),
    `Due ${new Date(a.dueAt).toUTCString()}`, `/courses/${courseId}/assignments/${a.id}`,
  ]);
}

export async function createAssignment(tx: Tx, courseId: string, input: AssignmentInput) {
  await requireStaff(tx, courseId, { write: true });
  checkDates(input);
  const a = await tx.one<{ id: string; title: string; status: string; dueAt: string }>(
    `INSERT INTO assignments (course_id, title, instructions, due_at, late_until, points_possible, submission_type, max_attempts, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, title, status, due_at AS "dueAt"`,
    [courseId, input.title, input.instructions ?? '', input.dueAt, input.lateUntil ?? null, input.pointsPossible,
     input.submissionType ?? 'text_or_file', input.maxAttempts ?? 3, input.status ?? 'draft'],
  );
  await announceIfPublished(tx, courseId, a);
  return a;
}

export async function updateAssignment(tx: Tx, id: string, patch: Partial<AssignmentInput>) {
  const cur = await assignmentCourse(tx, id);
  await requireStaff(tx, cur.course_id, { write: true });
  const existing = await tx.one<{ dueAt: string; lateUntil: string | null }>(
    'SELECT due_at AS "dueAt", late_until AS "lateUntil" FROM assignments WHERE id = $1', [id]);
  checkDates({ dueAt: patch.dueAt ?? existing.dueAt, lateUntil: patch.lateUntil === undefined ? existing.lateUntil : patch.lateUntil });
  const a = await tx.one<{ id: string; title: string; status: string; dueAt: string }>(
    `UPDATE assignments SET
       title = coalesce($2, title), instructions = coalesce($3, instructions), due_at = coalesce($4, due_at),
       late_until = CASE WHEN $5::boolean THEN $6::timestamptz ELSE late_until END,
       points_possible = coalesce($7, points_possible), submission_type = coalesce($8, submission_type),
       max_attempts = coalesce($9, max_attempts), status = coalesce($10, status)
     WHERE id = $1 RETURNING id, title, status, due_at AS "dueAt"`,
    [id, patch.title ?? null, patch.instructions ?? null, patch.dueAt ?? null, patch.lateUntil !== undefined, patch.lateUntil ?? null,
     patch.pointsPossible ?? null, patch.submissionType ?? null, patch.maxAttempts ?? null, patch.status ?? null],
  );
  if (cur.status !== 'published' && a.status === 'published') await announceIfPublished(tx, cur.course_id, a);
  return a;
}

export async function deleteAssignment(tx: Tx, id: string) {
  const cur = await assignmentCourse(tx, id);
  await requireStaff(tx, cur.course_id, { write: true });
  const used = await tx.one<{ n: number }>(
    `SELECT ((SELECT count(*) FROM submissions WHERE assignment_id = $1) + (SELECT count(*) FROM grades WHERE assignment_id = $1))::int AS n`, [id]);
  if (used.n > 0) throw conflict('This assignment has submissions or grades and cannot be deleted.');
  await tx.query('DELETE FROM assignments WHERE id = $1', [id]);
  return cur.course_id;
}

const submissionCols = `s.id, s.attempt, s.body, s.submitted_at AS "submittedAt", s.is_late AS "isLate",
  s.file_id AS "fileId", f.original_name AS "fileName", f.size_bytes AS "fileSize"`;

export async function getAssignment(tx: Tx, id: string, auth: AuthContext) {
  const a = await tx.maybeOne<Record<string, unknown> & { courseId: string; dueAt: string; lateUntil: string | null; maxAttempts: number }>(
    `SELECT ${cols}, c.title AS "courseTitle", c.code AS "courseCode" FROM assignments a JOIN courses c ON c.id = a.course_id WHERE a.id = $1`, [id]);
  if (!a) throw notFound('Assignment');
  const access = await requireVisible(tx, a.courseId);
  if (access.isStaff) {
    const stats = await tx.one(
      `SELECT app.active_enrollment_count($2) AS "studentCount",
              (SELECT count(DISTINCT student_id) FROM submissions WHERE assignment_id = $1)::int AS "submittedCount",
              (SELECT count(*) FROM grades WHERE assignment_id = $1)::int AS "gradedCount",
              (SELECT count(*) FROM grades WHERE assignment_id = $1 AND released_at IS NULL)::int AS "unreleasedCount"`,
      [id, a.courseId]);
    return { assignment: a, relationship: 'staff', writable: access.writable, stats };
  }
  const submissions = await tx.query(
    `SELECT ${submissionCols} FROM submissions s LEFT JOIN files f ON f.id = s.file_id
      WHERE s.assignment_id = $1 AND s.student_id = $2 ORDER BY s.attempt DESC`, [id, auth.userId]);
  const grade = await tx.maybeOne(
    `SELECT score, feedback, released_at AS "releasedAt", graded_at AS "gradedAt" FROM grades WHERE assignment_id = $1 AND student_id = $2`,
    [id, auth.userId]);
  const window = submissionWindow(a);
  const attemptsLeft = Math.max(0, a.maxAttempts - submissions.length);
  return {
    assignment: a,
    relationship: 'learner',
    submissions,
    grade,
    canSubmit: window.open && attemptsLeft > 0 && access.status === 'published' && access.isLearner,
    willBeLate: window.late,
    attemptsLeft,
  };
}

export async function submit(tx: Tx, id: string, auth: AuthContext, input: { body?: string | null; fileId?: string | null; clientToken?: string }) {
  const cur = await assignmentCourse(tx, id);
  await requireVisible(tx, cur.course_id);
  if (input.clientToken) {
    const prior = await tx.maybeOne(
      `SELECT ${submissionCols} FROM submissions s LEFT JOIN files f ON f.id = s.file_id
        WHERE s.assignment_id = $1 AND s.student_id = $2 AND s.client_token = $3`, [id, auth.userId, input.clientToken]);
    if (prior) return { submission: prior, duplicate: true };
  }
  // attempt, submitted_at and is_late are set by the database trigger; client values are ignored.
  const row = await tx.one<{ id: string }>(
    `INSERT INTO submissions (assignment_id, student_id, attempt, body, file_id, client_token)
     VALUES ($1, $2, 1, $3, $4, $5) RETURNING id`,
    [id, auth.userId, input.body ?? null, input.fileId ?? null, input.clientToken ?? null]);
  const submission = await tx.one(
    `SELECT ${submissionCols} FROM submissions s LEFT JOIN files f ON f.id = s.file_id WHERE s.id = $1`, [row.id]);
  return { submission, duplicate: false };
}

export async function gradingQueue(tx: Tx, id: string) {
  const cur = await assignmentCourse(tx, id);
  await requireStaff(tx, cur.course_id);
  return tx.query(
    `SELECT u.id AS "studentId", u.full_name AS "fullName", e.status AS "enrollmentStatus",
            ls.attempt, ls.submitted_at AS "submittedAt", ls.is_late AS "isLate",
            (SELECT count(*) FROM submissions s WHERE s.assignment_id = $1 AND s.student_id = u.id)::int AS attempts,
            g.score, g.released_at AS "releasedAt", g.graded_at AS "gradedAt", g.version,
            (ls.submitted_at IS NOT NULL AND (g.graded_at IS NULL OR g.graded_at < ls.submitted_at)) AS "needsGrading"
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN LATERAL (SELECT attempt, submitted_at, is_late FROM submissions s
                           WHERE s.assignment_id = $1 AND s.student_id = u.id ORDER BY attempt DESC LIMIT 1) ls ON true
       LEFT JOIN grades g ON g.assignment_id = $1 AND g.student_id = u.id
      WHERE e.course_id = $2 AND e.status IN ('active', 'completed')
      ORDER BY "needsGrading" DESC, ls.submitted_at NULLS LAST, u.full_name`,
    [id, cur.course_id]);
}

export async function studentWork(tx: Tx, id: string, studentId: string) {
  const cur = await assignmentCourse(tx, id);
  await requireStaff(tx, cur.course_id);
  const student = await tx.maybeOne(
    `SELECT u.id, u.full_name AS "fullName", u.email FROM enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.course_id = $1 AND e.user_id = $2`, [cur.course_id, studentId]);
  if (!student) throw notFound('Learner');
  const submissions = await tx.query(
    `SELECT ${submissionCols} FROM submissions s LEFT JOIN files f ON f.id = s.file_id
      WHERE s.assignment_id = $1 AND s.student_id = $2 ORDER BY s.attempt DESC`, [id, studentId]);
  const grade = await tx.maybeOne(
    `SELECT g.score, g.feedback, g.released_at AS "releasedAt", g.graded_at AS "gradedAt", g.version, u.full_name AS "gradedBy"
       FROM grades g LEFT JOIN users u ON u.id = g.graded_by WHERE g.assignment_id = $1 AND g.student_id = $2`, [id, studentId]);
  return { student, submissions, grade };
}

export async function saveGrade(
  tx: Tx, id: string, studentId: string,
  input: { score: number; feedback?: string; expectedVersion?: number | null; release?: boolean },
) {
  const cur = await assignmentCourse(tx, id);
  await requireStaff(tx, cur.course_id, { write: true });
  const existing = await tx.maybeOne<{ version: number; released_at: Date | null }>(
    'SELECT version, released_at FROM grades WHERE assignment_id = $1 AND student_id = $2 FOR UPDATE', [id, studentId]);

  let row: { version: number; releasedAt: string | null; score: number };
  if (existing) {
    if (input.expectedVersion != null && input.expectedVersion !== existing.version) {
      throw conflict('Someone else updated this grade while you were editing. Reload to see the latest version.');
    }
    row = await tx.one(
      `UPDATE grades SET score = $3, feedback = $4, released_at = CASE WHEN $5 THEN coalesce(released_at, now()) ELSE released_at END
        WHERE assignment_id = $1 AND student_id = $2 RETURNING version, released_at AS "releasedAt", score`,
      [id, studentId, input.score, input.feedback ?? '', input.release ?? false]);
  } else {
    if (input.expectedVersion != null) {
      throw conflict('This grade was removed or never saved. Reload and try again.');
    }
    row = await tx.one(
      `INSERT INTO grades (assignment_id, student_id, score, feedback, released_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END) RETURNING version, released_at AS "releasedAt", score`,
      [id, studentId, input.score, input.feedback ?? '', input.release ?? false]);
  }
  const newlyReleased = input.release && !existing?.released_at;
  if (newlyReleased) {
    await tx.query('SELECT app.notify_student($1, $2, $3, $4, $5, $6)', [
      cur.course_id, studentId, 'grade', `Grade released: ${cur.title}`.slice(0, 200),
      'Your trainer has released your grade and feedback.', `/courses/${cur.course_id}/assignments/${id}`]);
  }
  return { ...row, courseId: cur.course_id, newlyReleased: Boolean(newlyReleased) };
}

export async function releaseAll(tx: Tx, id: string) {
  const cur = await assignmentCourse(tx, id);
  await requireStaff(tx, cur.course_id, { write: true });
  const released = await tx.query<{ student_id: string }>(
    'UPDATE grades SET released_at = now() WHERE assignment_id = $1 AND released_at IS NULL RETURNING student_id', [id]);
  for (const r of released) {
    await tx.query('SELECT app.notify_student($1, $2, $3, $4, $5, $6)', [
      cur.course_id, r.student_id, 'grade', `Grade released: ${cur.title}`.slice(0, 200),
      'Your trainer has released your grade and feedback.', `/courses/${cur.course_id}/assignments/${id}`]);
  }
  return { released: released.length, courseId: cur.course_id };
}
