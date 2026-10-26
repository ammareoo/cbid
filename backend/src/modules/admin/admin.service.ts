import type { Tx } from '../../db/pool.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { likePattern, offset, paged, type PageQuery } from '../../lib/http.js';

export async function dashboard(tx: Tx) {
  const counts = await tx.one(
    `SELECT
       (SELECT count(*) FROM users WHERE role = 'student' AND status = 'active')::int AS "activeStudents",
       (SELECT count(*) FROM users WHERE role = 'teacher' AND status = 'active')::int AS "activeTeachers",
       (SELECT count(*) FROM users WHERE status = 'deactivated')::int AS "deactivatedUsers",
       (SELECT count(*) FROM courses WHERE status = 'published')::int AS "publishedCourses",
       (SELECT count(*) FROM courses WHERE status = 'draft')::int AS "draftCourses",
       (SELECT count(*) FROM courses WHERE status = 'archived')::int AS "archivedCourses",
       (SELECT count(*) FROM enrollments WHERE status = 'active')::int AS "activeEnrollments",
       (SELECT count(*) FROM submissions WHERE submitted_at > now() - interval '7 days')::int AS "submissionsLast7Days",
       (SELECT count(*) FROM users WHERE last_login_at > now() - interval '7 days')::int AS "activeUsersLast7Days"`);
  const attention = await tx.query(
    `SELECT c.id, c.code, c.title, c.status,
            (SELECT count(*) FROM course_teachers ct WHERE ct.course_id = c.id)::int AS "teacherCount",
            (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active')::int AS "studentCount",
            c.capacity
       FROM courses c
      WHERE c.status <> 'archived'
        AND (NOT EXISTS (SELECT 1 FROM course_teachers ct WHERE ct.course_id = c.id)
             OR (c.capacity IS NOT NULL AND (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') >= c.capacity))
      ORDER BY c.code LIMIT 10`);
  const recentActivity = await tx.query(
    `SELECT l.id, l.action, l.entity_type AS "entityType", l.created_at AS "createdAt", u.full_name AS "actorName"
       FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
      ORDER BY l.created_at DESC LIMIT 8`);
  return { counts, attention, recentActivity };
}

export async function listUsers(tx: Tx, q: PageQuery & { search?: string; role?: string; status?: string }) {
  const params: unknown[] = [];
  const where: string[] = ['true'];
  if (q.search) {
    params.push(likePattern(q.search));
    where.push(`(u.full_name ILIKE $${params.length} OR u.email::text ILIKE $${params.length})`);
  }
  if (q.role) { params.push(q.role); where.push(`u.role = $${params.length}`); }
  if (q.status) { params.push(q.status); where.push(`u.status = $${params.length}`); }
  const w = where.join(' AND ');
  const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM users u WHERE ${w}`, params);
  params.push(q.pageSize, offset(q));
  const items = await tx.query(
    `SELECT u.id, u.email, u.full_name AS "fullName", u.role, u.status, u.last_login_at AS "lastLoginAt",
            u.created_at AS "createdAt", d.name AS "departmentName", u.department_id AS "departmentId"
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE ${w} ORDER BY u.full_name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return paged(items, total.n, q);
}

export async function getUser(tx: Tx, id: string) {
  const user = await tx.maybeOne(
    `SELECT u.id, u.email, u.full_name AS "fullName", u.preferred_name AS "preferredName", u.role, u.status,
            u.department_id AS "departmentId", u.timezone, u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt"
       FROM users u WHERE u.id = $1`, [id]);
  if (!user) throw notFound('User');
  const enrollments = await tx.query(
    `SELECT e.id, e.status, e.enrolled_at AS "enrolledAt", c.id AS "courseId", c.code, c.title
       FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1 ORDER BY c.code`, [id]);
  const teaching = await tx.query(
    `SELECT c.id AS "courseId", c.code, c.title, c.status, ct.is_lead AS "isLead"
       FROM course_teachers ct JOIN courses c ON c.id = ct.course_id WHERE ct.user_id = $1 ORDER BY c.code`, [id]);
  return { user, enrollments, teaching };
}

export async function createUser(tx: Tx, input: { email: string; fullName: string; role: string; departmentId?: string | null }, unusableHash: string) {
  return tx.one<{ id: string; email: string; fullName: string }>(
    `INSERT INTO users (email, password_hash, full_name, role, department_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name AS "fullName"`,
    [input.email, unusableHash, input.fullName, input.role, input.departmentId ?? null]);
}

export async function updateUser(tx: Tx, id: string, patch: { fullName?: string; email?: string; role?: string; status?: string; departmentId?: string | null }) {
  const before = await tx.maybeOne<{ role: string; status: string; email: string }>('SELECT role, status, email FROM users WHERE id = $1', [id]);
  if (!before) throw notFound('User');
  // Privilege rules (no self-change, no admin grant/edit) are enforced by the users_guard trigger.
  const after = await tx.one<{ role: string; status: string }>(
    `UPDATE users SET full_name = coalesce($2, full_name), email = coalesce($3, email), role = coalesce($4, role),
            status = coalesce($5, status), department_id = CASE WHEN $6::boolean THEN $7::uuid ELSE department_id END
      WHERE id = $1 RETURNING role, status`,
    [id, patch.fullName ?? null, patch.email ?? null, patch.role ?? null, patch.status ?? null,
     patch.departmentId !== undefined, patch.departmentId ?? null]);
  if (after.status === 'deactivated' && before.status !== 'deactivated') {
    await tx.query('SELECT app.auth_revoke_user_sessions($1)', [id]);
  }
  if (after.role !== before.role) {
    await tx.query('SELECT app.auth_revoke_user_sessions($1)', [id]);
  }
  return { before, after };
}

export async function listCourses(tx: Tx, q: PageQuery & { search?: string; status?: string; termId?: string }) {
  const params: unknown[] = [];
  const where: string[] = ['true'];
  if (q.search) {
    params.push(likePattern(q.search));
    where.push(`(c.title ILIKE $${params.length} OR c.code ILIKE $${params.length})`);
  }
  if (q.status) { params.push(q.status); where.push(`c.status = $${params.length}`); }
  if (q.termId) { params.push(q.termId); where.push(`c.term_id = $${params.length}`); }
  const w = where.join(' AND ');
  const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM courses c WHERE ${w}`, params);
  params.push(q.pageSize, offset(q));
  const items = await tx.query(
    `SELECT c.id, c.code, c.title, c.status, c.enrollment_open AS "enrollmentOpen", c.capacity,
            c.delivery_mode AS "deliveryMode", t.name AS "termName", d.name AS "departmentName",
            (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active')::int AS "studentCount",
            (SELECT string_agg(u.full_name, ', ' ORDER BY ct.is_lead DESC) FROM course_teachers ct JOIN users u ON u.id = ct.user_id
              WHERE ct.course_id = c.id) AS teachers
       FROM courses c JOIN terms t ON t.id = c.term_id LEFT JOIN departments d ON d.id = c.department_id
      WHERE ${w} ORDER BY t.starts_on DESC, c.code LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return paged(items, total.n, q);
}

export interface CourseInput {
  code: string; title: string; summary?: string; description?: string; departmentId?: string | null; termId: string;
  status?: 'draft' | 'published' | 'archived'; enrollmentOpen?: boolean; capacity?: number | null;
  audience?: string; deliveryMode?: 'online' | 'blended' | 'onsite';
}

export async function createCourse(tx: Tx, input: CourseInput) {
  return tx.one<{ id: string }>(
    `INSERT INTO courses (code, title, summary, description, department_id, term_id, status, enrollment_open, capacity,
                          audience, delivery_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [input.code, input.title, input.summary ?? '', input.description ?? '', input.departmentId ?? null, input.termId,
     input.status ?? 'draft', input.enrollmentOpen ?? false, input.capacity ?? null, input.audience ?? '', input.deliveryMode ?? 'online']);
}

export async function getCourseAdmin(tx: Tx, id: string) {
  const course = await tx.maybeOne(
    `SELECT c.id, c.code, c.title, c.summary, c.description, c.status, c.enrollment_open AS "enrollmentOpen", c.capacity,
            c.audience, c.delivery_mode AS "deliveryMode", c.term_id AS "termId", c.department_id AS "departmentId", c.created_at AS "createdAt", c.archived_at AS "archivedAt"
       FROM courses c WHERE c.id = $1`, [id]);
  if (!course) throw notFound('Course');
  const teachers = await tx.query(
    `SELECT u.id, u.full_name AS "fullName", u.email, ct.is_lead AS "isLead"
       FROM course_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.course_id = $1 ORDER BY ct.is_lead DESC, u.full_name`, [id]);
  const enrollments = await tx.query(
    `SELECT e.id, e.status, e.enrolled_at AS "enrolledAt", u.id AS "userId", u.full_name AS "fullName", u.email
       FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = $1 ORDER BY e.status, u.full_name`, [id]);
  return { course, teachers, enrollments };
}

export async function updateCourseAdmin(tx: Tx, id: string, patch: Partial<CourseInput>) {
  const set: string[] = [];
  const params: unknown[] = [id];
  const map: Record<string, string> = {
    code: 'code', title: 'title', summary: 'summary', description: 'description', departmentId: 'department_id',
    termId: 'term_id', status: 'status', enrollmentOpen: 'enrollment_open', capacity: 'capacity',
    audience: 'audience', deliveryMode: 'delivery_mode',
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) {
      params.push((patch as Record<string, unknown>)[k] ?? null);
      set.push(`${col} = $${params.length}`);
    }
  }
  if (!set.length) throw unprocessable('Nothing to update');
  const row = await tx.maybeOne(`UPDATE courses SET ${set.join(', ')} WHERE id = $1 RETURNING id, status`, params);
  if (!row) throw notFound('Course');
  return row;
}

export async function deleteDraftCourse(tx: Tx, id: string) {
  const c = await tx.maybeOne<{ status: string }>('SELECT status FROM courses WHERE id = $1', [id]);
  if (!c) throw notFound('Course');
  if (c.status !== 'draft') throw conflict('Only draft courses can be deleted. Archive published courses instead.');
  await tx.query('DELETE FROM courses WHERE id = $1', [id]);
}

export async function enrollStudents(tx: Tx, courseId: string, userIds: string[]) {
  const results: { userId: string; status: 'enrolled' | 'reactivated' | 'already_enrolled' }[] = [];
  for (const userId of userIds) {
    const r = await tx.maybeOne<{ inserted: boolean; status: string }>(
      `INSERT INTO enrollments (course_id, user_id) VALUES ($1, $2)
       ON CONFLICT (course_id, user_id) DO UPDATE SET status = 'active'
         WHERE enrollments.status <> 'active'
       RETURNING (xmax = 0) AS inserted, status`, [courseId, userId]);
    results.push({ userId, status: !r ? 'already_enrolled' : r.inserted ? 'enrolled' : 'reactivated' });
  }
  return results;
}

export async function listAudit(tx: Tx, q: PageQuery & { action?: string; actorId?: string; entityType?: string }) {
  const params: unknown[] = [];
  const where: string[] = ['true'];
  if (q.action) { params.push(q.action + '%'); where.push(`l.action LIKE $${params.length}`); }
  if (q.actorId) { params.push(q.actorId); where.push(`l.actor_id = $${params.length}`); }
  if (q.entityType) { params.push(q.entityType); where.push(`l.entity_type = $${params.length}`); }
  const w = where.join(' AND ');
  const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs l WHERE ${w}`, params);
  params.push(q.pageSize, offset(q));
  const items = await tx.query(
    `SELECT l.id, l.action, l.entity_type AS "entityType", l.entity_id AS "entityId", l.details, host(l.ip) AS ip,
            l.created_at AS "createdAt", u.full_name AS "actorName", u.email AS "actorEmail"
       FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
      WHERE ${w} ORDER BY l.created_at DESC, l.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return paged(items, total.n, q);
}
