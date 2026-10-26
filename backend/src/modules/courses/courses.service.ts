import type { Tx } from '../../db/pool.js';
import { notFound, forbidden } from '../../lib/errors.js';
import { likePattern, offset, paged, type PageQuery } from '../../lib/http.js';
import type { AuthContext } from '../../types.js';

export interface CourseAccess {
  id: string;
  code: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  isStaff: boolean;
  isLearner: boolean;
  writable: boolean;
}

/**
 * Loads a course through RLS and reports the caller's relationship to it.
 * Returns 404 (not 403) when the course is invisible, so ids cannot be probed.
 */
export async function courseAccess(tx: Tx, courseId: string): Promise<CourseAccess> {
  const row = await tx.maybeOne<CourseAccess>(
    `SELECT c.id, c.code, c.title, c.status,
            app.course_staff(c.id) AS "isStaff",
            app.enrolled(c.id) AS "isLearner",
            app.course_writable(c.id) AS writable
       FROM courses c WHERE c.id = $1`,
    [courseId],
  );
  if (!row) throw notFound('Course');
  return row;
}

export async function requireStaff(tx: Tx, courseId: string, opts: { write?: boolean } = {}) {
  const access = await courseAccess(tx, courseId);
  if (!access.isStaff) throw notFound('Course');
  if (opts.write && !access.writable) throw forbidden('This course is archived and read-only');
  return access;
}

export async function requireVisible(tx: Tx, courseId: string) {
  const access = await courseAccess(tx, courseId);
  if (!access.isStaff && !(access.isLearner && access.status !== 'draft')) throw notFound('Course');
  return access;
}

const progressSql = `
  (SELECT CASE WHEN count(i.id) = 0 THEN NULL
               ELSE round(100.0 * count(ic.item_id) / count(i.id)) END
     FROM modules m
     JOIN module_items i ON i.module_id = m.id AND i.published
     LEFT JOIN item_completions ic ON ic.item_id = i.id AND ic.user_id = $1
    WHERE m.course_id = c.id AND m.published)`;

export async function myCourses(tx: Tx, auth: AuthContext) {
  if (auth.role === 'student') {
    return tx.query(
      `SELECT c.id, c.code, c.title, c.summary, c.status, t.name AS "termName", e.status AS "enrollmentStatus",
              ${progressSql}::int AS progress,
              (SELECT min(a.due_at) FROM assignments a
                 WHERE a.course_id = c.id AND a.status = 'published' AND a.due_at > now()
                   AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = $1)) AS "nextDueAt",
              (SELECT string_agg(u.full_name, ', ' ORDER BY ct.is_lead DESC, u.full_name)
                 FROM course_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.course_id = c.id) AS teachers
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN terms t ON t.id = c.term_id
        WHERE e.user_id = $1 AND e.status IN ('active', 'completed') AND c.status IN ('published', 'archived')
        ORDER BY (c.status = 'archived'), c.code`,
      [auth.userId],
    );
  }
  return tx.query(
    `SELECT c.id, c.code, c.title, c.summary, c.status, t.name AS "termName", ct.is_lead AS "isLead",
            app.active_enrollment_count(c.id) AS "studentCount",
            (SELECT count(*) FROM submissions s
               JOIN assignments a ON a.id = s.assignment_id
              WHERE a.course_id = c.id
                AND s.attempt = (SELECT max(s2.attempt) FROM submissions s2
                                  WHERE s2.assignment_id = s.assignment_id AND s2.student_id = s.student_id)
                AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.assignment_id = s.assignment_id
                                  AND g.student_id = s.student_id AND g.graded_at >= s.submitted_at))::int AS "needsGrading"
       FROM course_teachers ct
       JOIN courses c ON c.id = ct.course_id
       JOIN terms t ON t.id = c.term_id
      WHERE ct.user_id = $1
      ORDER BY (c.status = 'archived'), c.code`,
    [auth.userId],
  );
}

export async function catalogue(tx: Tx, q: PageQuery & { search?: string; departmentId?: string; mode?: 'online' | 'blended' | 'onsite' }) {
  const params: unknown[] = [];
  const where = [`c.status = 'published'`];
  if (q.search) {
    params.push(likePattern(q.search));
    where.push(`(c.title ILIKE $${params.length} OR c.code ILIKE $${params.length} OR c.summary ILIKE $${params.length} OR c.audience ILIKE $${params.length})`);
  }
  if (q.departmentId) {
    params.push(q.departmentId);
    where.push(`c.department_id = $${params.length}`);
  }
  if (q.mode) {
    params.push(q.mode);
    where.push(`c.delivery_mode = $${params.length}`);
  }
  const whereSql = where.join(' AND ');
  const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM courses c WHERE ${whereSql}`, params);
  params.push(q.pageSize, offset(q));
  const items = await tx.query(
    `SELECT c.id, c.code, c.title, c.summary, c.enrollment_open AS "enrollmentOpen", c.capacity,
            c.audience, c.delivery_mode AS "deliveryMode",
            app.active_enrollment_count(c.id) AS "enrolledCount",
            d.name AS "departmentName", t.name AS "termName",
            app.enrolled(c.id) AS "isEnrolled",
            (SELECT string_agg(u.full_name, ', ' ORDER BY ct.is_lead DESC, u.full_name)
               FROM course_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.course_id = c.id) AS teachers
       FROM courses c
       LEFT JOIN departments d ON d.id = c.department_id
       JOIN terms t ON t.id = c.term_id
      WHERE ${whereSql}
      ORDER BY c.code
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return paged(items, total.n, q);
}

export async function courseDetail(tx: Tx, courseId: string, auth: AuthContext) {
  const access = await courseAccess(tx, courseId);
  const course = await tx.one<Record<string, unknown>>(
    `SELECT c.id, c.code, c.title, c.summary, c.description, c.status, c.enrollment_open AS "enrollmentOpen",
            c.capacity, app.active_enrollment_count(c.id) AS "enrolledCount", c.audience, c.delivery_mode AS "deliveryMode",
            d.name AS "departmentName", t.name AS "termName", t.starts_on AS "termStartsOn", t.ends_on AS "termEndsOn",
            (SELECT e.status FROM enrollments e WHERE e.course_id = c.id AND e.user_id = $2) AS "enrollmentStatus"
       FROM courses c
       LEFT JOIN departments d ON d.id = c.department_id
       JOIN terms t ON t.id = c.term_id
      WHERE c.id = $1`,
    [courseId, auth.userId],
  );
  const teachers = await tx.query(
    `SELECT u.id, u.full_name AS "fullName", ct.is_lead AS "isLead"
       FROM course_teachers ct JOIN users u ON u.id = ct.user_id
      WHERE ct.course_id = $1 ORDER BY ct.is_lead DESC, u.full_name`,
    [courseId],
  );
  const canLearn = access.isLearner && access.status !== 'draft';
  const relationship = access.isStaff ? 'staff' : canLearn ? 'learner' : 'visitor';
  let progress: number | null = null;
  let certificate: { id: string; serial: string; issuedAt: string } | null = null;
  if (relationship === 'learner') {
    const p = await tx.one<{ progress: number | null }>(`SELECT ${progressSql}::int AS progress FROM courses c WHERE c.id = $2`, [auth.userId, courseId]);
    progress = p.progress;
    certificate = await tx.maybeOne(
      `SELECT id, serial, issued_at AS "issuedAt" FROM certificates
        WHERE course_id = $1 AND user_id = $2 AND revoked_at IS NULL`, [courseId, auth.userId]);
  }
  return { ...course, teachers, relationship, writable: access.writable, progress, certificate };
}

export async function updateCourseContent(tx: Tx, courseId: string, patch: { title?: string; summary?: string; description?: string }) {
  await requireStaff(tx, courseId, { write: true });
  const row = await tx.maybeOne(
    `UPDATE courses SET
       title = coalesce($2, title), summary = coalesce($3, summary), description = coalesce($4, description)
     WHERE id = $1 RETURNING id, title, summary, description`,
    [courseId, patch.title ?? null, patch.summary ?? null, patch.description ?? null],
  );
  if (!row) throw notFound('Course');
  return row;
}

export async function selfEnroll(tx: Tx, courseId: string, auth: AuthContext) {
  const existing = await tx.maybeOne<{ id: string; status: string }>(
    'SELECT id, status FROM enrollments WHERE course_id = $1 AND user_id = $2', [courseId, auth.userId]);
  if (existing?.status === 'active') return existing;
  if (existing) {
    // Re-joining after withdrawing is an administrator decision (grades/history continuity).
    throw forbidden('You withdrew from this course. Contact the CBID Institute team to re-enrol.');
  }
  return tx.one('INSERT INTO enrollments (course_id, user_id) VALUES ($1, $2) RETURNING id, status', [courseId, auth.userId]);
}

export async function withdraw(tx: Tx, courseId: string, auth: AuthContext) {
  const row = await tx.maybeOne(
    `UPDATE enrollments SET status = 'dropped' WHERE course_id = $1 AND user_id = $2 AND status = 'active' RETURNING id, status`,
    [courseId, auth.userId],
  );
  if (!row) throw notFound('Active enrolment');
  return row;
}

export async function roster(tx: Tx, courseId: string) {
  await requireStaff(tx, courseId);
  return tx.query(
    `WITH items AS (
       SELECT i.id FROM module_items i JOIN modules m ON m.id = i.module_id
        WHERE m.course_id = $1 AND m.published AND i.published
     ), work AS (
       SELECT id, points_possible FROM assignments WHERE course_id = $1 AND status = 'published'
     )
     SELECT u.id, u.full_name AS "fullName", u.email, e.status AS "enrollmentStatus", e.enrolled_at AS "enrolledAt",
            (SELECT cert.serial FROM certificates cert WHERE cert.course_id = $1 AND cert.user_id = u.id AND cert.revoked_at IS NULL) AS "certificateSerial",
            CASE WHEN (SELECT count(*) FROM items) = 0 THEN NULL ELSE
              round(100.0 * (SELECT count(*) FROM item_completions ic WHERE ic.user_id = u.id AND ic.item_id IN (SELECT id FROM items))
                    / (SELECT count(*) FROM items))::int END AS progress,
            (SELECT count(DISTINCT s.assignment_id) FROM submissions s WHERE s.student_id = u.id AND s.assignment_id IN (SELECT id FROM work))::int AS submitted,
            (SELECT count(*) FROM work)::int AS "assignmentCount",
            (SELECT round(100.0 * sum(g.score) / nullif(sum(w.points_possible), 0), 1)
               FROM grades g JOIN work w ON w.id = g.assignment_id WHERE g.student_id = u.id) AS "gradePercent",
            (SELECT max(s.submitted_at) FROM submissions s WHERE s.student_id = u.id AND s.assignment_id IN (SELECT id FROM work)) AS "lastSubmissionAt"
       FROM enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.course_id = $1
      ORDER BY e.status = 'active' DESC, u.full_name`,
    [courseId],
  );
}

/** Staff gradebook: one row per learner, one cell per published assignment. */
export async function gradebook(tx: Tx, courseId: string) {
  await requireStaff(tx, courseId);
  const assignments = await tx.query<{ id: string; title: string; pointsPossible: number; dueAt: string }>(
    `SELECT id, title, points_possible AS "pointsPossible", due_at AS "dueAt"
       FROM assignments WHERE course_id = $1 AND status = 'published' ORDER BY due_at, title`, [courseId]);
  const students = await tx.query<{ id: string; fullName: string }>(
    `SELECT u.id, u.full_name AS "fullName" FROM enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.course_id = $1 AND e.status IN ('active', 'completed') ORDER BY u.full_name`, [courseId]);
  const cells = await tx.query<{ studentId: string; assignmentId: string; score: number | null; released: boolean; submitted: boolean; late: boolean }>(
    `SELECT e.user_id AS "studentId", a.id AS "assignmentId", g.score, (g.released_at IS NOT NULL) AS released,
            EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = e.user_id) AS submitted,
            coalesce((SELECT bool_or(s.is_late) FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = e.user_id), false) AS late
       FROM enrollments e
       JOIN assignments a ON a.course_id = e.course_id AND a.status = 'published'
       LEFT JOIN grades g ON g.assignment_id = a.id AND g.student_id = e.user_id
      WHERE e.course_id = $1 AND e.status IN ('active', 'completed')`, [courseId]);
  return { assignments, students, cells };
}

/** A learner's own released grades for one course. */
export async function myCourseGrades(tx: Tx, courseId: string, auth: AuthContext) {
  await requireVisible(tx, courseId);
  return tx.query(
    `SELECT a.id AS "assignmentId", a.title, a.due_at AS "dueAt", a.points_possible AS "pointsPossible",
            g.score, g.feedback, g.released_at AS "releasedAt",
            (SELECT max(s.submitted_at) FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = $2) AS "submittedAt"
       FROM assignments a
       LEFT JOIN grades g ON g.assignment_id = a.id AND g.student_id = $2
      WHERE a.course_id = $1 AND a.status = 'published'
      ORDER BY a.due_at`,
    [courseId, auth.userId],
  );
}
