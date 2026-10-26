import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { text } from '../../lib/http.js';
import type { AuthContext } from '../../types.js';
import { myCourses } from '../courses/courses.service.js';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));
const profilePatch = z.object({
  fullName: text(1, 120),
  preferredName: z.string().trim().max(60).nullable().transform((v) => (v ? v : null)),
  timezone: z.string().refine((tz) => TIMEZONES.has(tz) || tz === 'UTC', 'Choose a valid time zone'),
}).partial().strict();
const prefsBody = z.object({
  emailAnnouncements: z.boolean(),
  emailGrades: z.boolean(),
  emailDeadlines: z.boolean(),
}).strict();

async function studentDashboard(tx: Tx, auth: AuthContext) {
  const courses = await myCourses(tx, auth);
  const upcoming = await tx.query(
    `SELECT * FROM (
       SELECT 'assignment' AS type, a.id, a.title, a.due_at AS "dueAt", a.course_id AS "courseId", c.code AS "courseCode",
              EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = $1) AS done
         FROM assignments a JOIN courses c ON c.id = a.course_id
         JOIN enrollments e ON e.course_id = a.course_id AND e.user_id = $1 AND e.status = 'active'
        WHERE a.status = 'published' AND c.status = 'published' AND a.due_at BETWEEN now() - interval '2 days' AND now() + interval '21 days'
       UNION ALL
       SELECT 'quiz', q.id, q.title, q.closes_at, q.course_id, c.code,
              EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.student_id = $1 AND qa.status = 'submitted')
         FROM quizzes q JOIN courses c ON c.id = q.course_id
         JOIN enrollments e ON e.course_id = q.course_id AND e.user_id = $1 AND e.status = 'active'
        WHERE q.status = 'published' AND c.status = 'published' AND q.closes_at BETWEEN now() AND now() + interval '21 days'
     ) x ORDER BY done, "dueAt" LIMIT 8`, [auth.userId]);
  const feedback = await tx.query(
    `SELECT g.assignment_id AS "assignmentId", a.title, a.course_id AS "courseId", c.code AS "courseCode",
            g.score, a.points_possible AS "pointsPossible", g.released_at AS "releasedAt"
       FROM grades g JOIN assignments a ON a.id = g.assignment_id JOIN courses c ON c.id = a.course_id
      WHERE g.student_id = $1 AND g.released_at IS NOT NULL
      ORDER BY g.released_at DESC LIMIT 4`, [auth.userId]);
  return { role: 'student', courses, upcoming, feedback };
}

async function teacherDashboard(tx: Tx, auth: AuthContext) {
  const courses = await myCourses(tx, auth);
  const toGrade = await tx.query(
    `SELECT s.assignment_id AS "assignmentId", a.title, a.course_id AS "courseId", c.code AS "courseCode",
            s.student_id AS "studentId", u.full_name AS "studentName", s.submitted_at AS "submittedAt", s.is_late AS "isLate"
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN courses c ON c.id = a.course_id
       JOIN course_teachers ct ON ct.course_id = c.id AND ct.user_id = $1
       JOIN users u ON u.id = s.student_id
      WHERE s.attempt = (SELECT max(attempt) FROM submissions s2 WHERE s2.assignment_id = s.assignment_id AND s2.student_id = s.student_id)
        AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.assignment_id = s.assignment_id AND g.student_id = s.student_id AND g.graded_at >= s.submitted_at)
        AND c.status <> 'archived'
      ORDER BY s.submitted_at LIMIT 8`, [auth.userId]);
  const upcoming = await tx.query(
    `SELECT a.id, a.title, a.due_at AS "dueAt", a.course_id AS "courseId", c.code AS "courseCode", a.status,
            (SELECT count(DISTINCT student_id) FROM submissions s WHERE s.assignment_id = a.id)::int AS "submittedCount",
            app.active_enrollment_count(a.course_id) AS "studentCount"
       FROM assignments a JOIN courses c ON c.id = a.course_id
       JOIN course_teachers ct ON ct.course_id = c.id AND ct.user_id = $1
      WHERE a.due_at BETWEEN now() - interval '1 day' AND now() + interval '21 days'
      ORDER BY a.due_at LIMIT 8`, [auth.userId]);
  return { role: 'teacher', courses, toGrade, upcoming };
}

export default async function meRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/profile', async (req) =>
    req.db((tx) => tx.one(
      `SELECT u.id, u.email, u.full_name AS "fullName", u.preferred_name AS "preferredName", u.role, u.timezone,
              u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt", d.name AS "departmentName"
         FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`, [req.auth!.userId])),
  );

  app.patch('/profile', async (req) => {
    const body = profilePatch.parse(req.body);
    return req.db(async (tx) => {
      const row = await tx.one(
        `UPDATE users SET full_name = coalesce($2, full_name),
                preferred_name = CASE WHEN $3::boolean THEN $4 ELSE preferred_name END,
                timezone = coalesce($5, timezone)
          WHERE id = $1
          RETURNING id, full_name AS "fullName", preferred_name AS "preferredName", timezone`,
        [req.auth!.userId, body.fullName ?? null, 'preferredName' in body, body.preferredName ?? null, body.timezone ?? null]);
      await audit(tx, req, 'profile.updated', 'user', req.auth!.userId, { fields: Object.keys(body) });
      return row;
    });
  });

  app.get('/notification-preferences', async (req) =>
    req.db(async (tx) => (await tx.maybeOne(
      `SELECT email_announcements AS "emailAnnouncements", email_grades AS "emailGrades", email_deadlines AS "emailDeadlines"
         FROM notification_preferences WHERE user_id = $1`, [req.auth!.userId]))
      ?? { emailAnnouncements: true, emailGrades: true, emailDeadlines: true }),
  );

  app.put('/notification-preferences', async (req) => {
    const b = prefsBody.parse(req.body);
    return req.db((tx) => tx.one(
      `INSERT INTO notification_preferences (user_id, email_announcements, email_grades, email_deadlines)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET email_announcements = $2, email_grades = $3, email_deadlines = $4
       RETURNING email_announcements AS "emailAnnouncements", email_grades AS "emailGrades", email_deadlines AS "emailDeadlines"`,
      [req.auth!.userId, b.emailAnnouncements, b.emailGrades, b.emailDeadlines]));
  });

  app.get('/dashboard', async (req) => {
    const auth = req.auth!;
    return req.db<unknown>((tx) => (auth.role === 'student' ? studentDashboard(tx, auth) : teacherDashboard(tx, auth)));
  });

  /** All of a student's released grades, grouped client-side by course. */
  app.get('/grades', { preHandler: app.requirePermission('grades.view_own') }, async (req) =>
    ({
      items: await req.db((tx) => tx.query(
        `SELECT c.id AS "courseId", c.code AS "courseCode", c.title AS "courseTitle",
                a.id AS "assignmentId", a.title, a.due_at AS "dueAt", a.points_possible AS "pointsPossible",
                g.score, g.released_at AS "releasedAt",
                EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = $1) AS submitted
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id AND c.status IN ('published', 'archived')
           JOIN assignments a ON a.course_id = c.id AND a.status = 'published'
           LEFT JOIN grades g ON g.assignment_id = a.id AND g.student_id = $1
          WHERE e.user_id = $1 AND e.status IN ('active', 'completed')
          ORDER BY c.code, a.due_at`, [req.auth!.userId])),
    }),
  );
}
