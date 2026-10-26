import type { Tx } from '../../db/pool.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { offset, paged, type PageQuery } from '../../lib/http.js';
import type { AuthContext } from '../../types.js';
import { requireStaff, requireVisible } from '../courses/courses.service.js';

const annCols = `a.id, a.course_id AS "courseId", c.code AS "courseCode", c.title AS "courseTitle", a.title, a.body,
  a.created_at AS "createdAt", u.full_name AS "authorName"`;

/** Announcement feed: institute-wide items plus courses the caller teaches or studies (RLS-filtered). */
export async function announcementFeed(tx: Tx, auth: AuthContext, q: PageQuery & { courseId?: string }) {
  const params: unknown[] = [];
  let where: string;
  if (q.courseId) {
    await requireVisible(tx, q.courseId);
    params.push(q.courseId);
    where = 'a.course_id = $1';
  } else {
    params.push(auth.userId);
    where = `(a.course_id IS NULL OR EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = a.course_id AND e.user_id = $1 AND e.status IN ('active','completed'))
              OR EXISTS (SELECT 1 FROM course_teachers ct WHERE ct.course_id = a.course_id AND ct.user_id = $1))`;
  }
  const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM announcements a WHERE ${where}`, params);
  params.push(q.pageSize, offset(q));
  const items = await tx.query(
    `SELECT ${annCols} FROM announcements a LEFT JOIN courses c ON c.id = a.course_id LEFT JOIN users u ON u.id = a.author_id
      WHERE ${where} ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return paged(items, total.n, q);
}

export async function postCourseAnnouncement(tx: Tx, courseId: string, auth: AuthContext, input: { title: string; body: string; notify?: boolean }) {
  const course = await requireStaff(tx, courseId, { write: true });
  const row = await tx.one<{ id: string }>(
    'INSERT INTO announcements (course_id, author_id, title, body) VALUES ($1, $2, $3, $4) RETURNING id',
    [courseId, auth.userId, input.title, input.body]);
  if (input.notify !== false) {
    await tx.query('SELECT app.notify_course($1, $2, $3, $4, $5)', [
      courseId, 'announcement', `${course.code}: ${input.title}`.slice(0, 200), input.body.slice(0, 300),
      `/courses/${courseId}/announcements`]);
  }
  return row;
}

export async function postGlobalAnnouncement(tx: Tx, auth: AuthContext, input: { title: string; body: string; notify?: boolean }) {
  const row = await tx.one<{ id: string }>(
    'INSERT INTO announcements (course_id, author_id, title, body) VALUES (NULL, $1, $2, $3) RETURNING id',
    [auth.userId, input.title, input.body]);
  if (input.notify !== false) {
    await tx.query('SELECT app.notify_all($1, $2, $3, $4)', ['system', input.title.slice(0, 200), input.body.slice(0, 300), '/announcements']);
  }
  return row;
}

export async function deleteAnnouncement(tx: Tx, id: string) {
  const r = await tx.maybeOne<{ course_id: string | null }>('DELETE FROM announcements WHERE id = $1 RETURNING course_id', [id]);
  if (!r) throw notFound('Announcement');
  return r;
}

export async function notifications(tx: Tx, auth: AuthContext, q: PageQuery & { unread?: boolean }) {
  const where = q.unread ? 'user_id = $1 AND read_at IS NULL' : 'user_id = $1';
  const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE ${where}`, [auth.userId]);
  const items = await tx.query(
    `SELECT id, kind, title, body, link, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [auth.userId, q.pageSize, offset(q)]);
  return paged(items, total.n, q);
}

export async function unreadCount(tx: Tx, auth: AuthContext) {
  const r = await tx.one<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [auth.userId]);
  return { unread: r.n };
}

export async function markRead(tx: Tx, auth: AuthContext, id?: string) {
  if (id) {
    const r = await tx.maybeOne('UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id', [id, auth.userId]);
    if (!r) throw notFound('Notification');
    return { updated: 1 };
  }
  const rows = await tx.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id', [auth.userId]);
  return { updated: rows.length };
}

/** Calendar entries in a bounded window: events plus assignment due dates and quiz windows. */
export async function calendar(tx: Tx, auth: AuthContext, from: Date, to: Date) {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 0 || days > 120) throw unprocessable('Choose a date range of up to 120 days');
  const mine = `(EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = %COL% AND e.user_id = $3 AND e.status IN ('active','completed'))
               OR EXISTS (SELECT 1 FROM course_teachers ct WHERE ct.course_id = %COL% AND ct.user_id = $3))`;
  return tx.query(
    `SELECT * FROM (
       SELECT 'event' AS type, ev.id, ev.title, ev.description, ev.location, ev.starts_at AS "startsAt", ev.ends_at AS "endsAt",
              ev.course_id AS "courseId", c.code AS "courseCode", NULL::text AS link
         FROM calendar_events ev LEFT JOIN courses c ON c.id = ev.course_id
        WHERE ev.starts_at < $2 AND ev.ends_at >= $1 AND (ev.course_id IS NULL OR ${mine.replaceAll('%COL%', 'ev.course_id')})
       UNION ALL
       SELECT 'assignment', a.id, a.title, '', NULL, a.due_at, a.due_at, a.course_id, c.code,
              '/courses/' || a.course_id || '/assignments/' || a.id
         FROM assignments a JOIN courses c ON c.id = a.course_id
        WHERE a.status = 'published' AND a.due_at BETWEEN $1 AND $2 AND ${mine.replaceAll('%COL%', 'a.course_id')}
       UNION ALL
       SELECT 'quiz', q.id, q.title, '', NULL, q.closes_at, q.closes_at, q.course_id, c.code,
              '/courses/' || q.course_id || '/quizzes/' || q.id
         FROM quizzes q JOIN courses c ON c.id = q.course_id
        WHERE q.status = 'published' AND q.closes_at BETWEEN $1 AND $2 AND ${mine.replaceAll('%COL%', 'q.course_id')}
     ) x ORDER BY "startsAt" LIMIT 500`,
    [from.toISOString(), to.toISOString(), auth.userId]);
}

export async function createEvent(tx: Tx, courseId: string | null, input: { title: string; description?: string; location?: string | null; startsAt: string; endsAt: string }) {
  if (new Date(input.endsAt) < new Date(input.startsAt)) throw unprocessable('The event must end after it starts');
  if (courseId) await requireStaff(tx, courseId, { write: true });
  return tx.one<{ id: string }>(
    `INSERT INTO calendar_events (course_id, title, description, location, starts_at, ends_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, app.uid()) RETURNING id`,
    [courseId, input.title, input.description ?? '', input.location ?? null, input.startsAt, input.endsAt]);
}

export async function deleteEvent(tx: Tx, id: string) {
  const r = await tx.maybeOne('DELETE FROM calendar_events WHERE id = $1 RETURNING id', [id]);
  if (!r) throw notFound('Event');
}
