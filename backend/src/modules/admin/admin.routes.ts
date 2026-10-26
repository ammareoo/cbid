import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { branding, emailFooter } from '../../lib/branding.js';
import { notFound } from '../../lib/errors.js';
import { idParams, likePattern, pageQuery, text, uuid } from '../../lib/http.js';
import { hashPassword, randomToken, sha256 } from '../../lib/security.js';
import { ASSIGNABLE_ROLES } from '../../permissions/policy.js';
import * as svc from './admin.service.js';

const email = z.string().trim().toLowerCase().email().max(254);
const role = z.enum(ASSIGNABLE_ROLES as unknown as [string, ...string[]]);
const userCreate = z.object({ email, fullName: text(1, 120), role, departmentId: uuid.nullish() }).strict();
const userPatch = z.object({
  fullName: text(1, 120), email, role, status: z.enum(['active', 'deactivated']), departmentId: uuid.nullable(),
}).partial().strict();
const courseCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}[0-9]{2,4}[A-Z]?$/, 'Use a code like DET101');
const courseBody = z.object({
  code: courseCode,
  title: text(3, 160),
  summary: z.string().trim().max(500).optional(),
  description: z.string().max(20000).optional(),
  departmentId: uuid.nullish(),
  termId: uuid,
  status: z.enum(['draft', 'published', 'archived']).optional(),
  enrollmentOpen: z.boolean().optional(),
  capacity: z.number().int().min(1).max(5000).nullish(),
  audience: z.string().trim().max(200).optional(),
  deliveryMode: z.enum(['online', 'blended', 'onsite']).optional(),
}).strict();
const deptBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/), name: text(2, 120) }).strict();
const termBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/), name: text(2, 80),
  startsOn: z.string().date(), endsOn: z.string().date(),
}).strict();
const SETTINGS = {
  institute_name: z.string().trim().min(2).max(120),
  organisation_name: z.string().trim().min(2).max(120),
  support_email: email,
  contact_phone: z.string().trim().max(60).regex(/^[0-9+()\-\s]*$/, 'Use digits, spaces and + ( ) - only'),
  contact_address: z.string().trim().max(200),
  website_url: z.string().trim().max(200).regex(/^https:\/\/[^\s<>"']+$/, 'Use a full https:// address'),
  self_enrollment_enabled: z.boolean(),
  maintenance_banner: z.string().trim().max(300),
} as const;
const settingsBody = z.object(SETTINGS).partial().strict();

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);
  const perm = (p: Parameters<typeof app.requirePermission>[0]) => ({ preHandler: app.requirePermission(p) });

  app.get('/dashboard', perm('admin.dashboard'), async (req) => req.db((tx) => svc.dashboard(tx)));

  app.get('/status', perm('admin.dashboard'), async (req) => {
    const started = Date.now();
    const ops = await req.db((tx) => tx.one<{ s: Record<string, unknown> }>('SELECT app.ops_status() AS s'));
    const dbLatencyMs = Date.now() - started;
    const migrations = await req.db((tx) => tx.query(
      "SELECT 1 FROM roles LIMIT 1")).then(() => 'ok').catch(() => 'error');
    let redis: 'ok' | 'not_configured' | 'error' = 'not_configured';
    const r = (app as unknown as { redis?: { ping(): Promise<string> } }).redis;
    if (r) redis = await r.ping().then(() => 'ok' as const).catch(() => 'error' as const);
    return {
      database: { status: migrations, latencyMs: dbLatencyMs },
      redis,
      ...ops.s,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      environment: app.config.NODE_ENV,
    };
  });

  // ---------------------------------------------------------------- users
  app.get('/users', perm('admin.users'), async (req) => {
    const q = pageQuery.extend({
      search: z.string().trim().max(100).optional(),
      role: z.enum(['student', 'teacher', 'admin']).optional(),
      status: z.enum(['active', 'deactivated']).optional(),
    }).parse(req.query);
    return req.db((tx) => svc.listUsers(tx, q));
  });

  app.get('/users/:id', perm('admin.users'), async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.getUser(tx, id));
  });

  app.post('/users', perm('admin.users'), async (req, reply) => {
    const body = userCreate.parse(req.body);
    // The account starts with an unusable password; the person sets their own via the invite link.
    const unusable = await hashPassword(randomToken());
    const token = randomToken();
    const user = await req.db(async (tx) => {
      const u = await svc.createUser(tx, body, unusable);
      await tx.query('SELECT * FROM app.auth_create_reset($1, $2, $3::interval)', [u.email, sha256(token), `${app.config.INVITE_HOURS} hours`]);
      const link = `${app.config.APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}&invite=1`;
      const b = await branding(tx);
      await tx.query('SELECT app.enqueue_email($1, $2, $3)', [u.email, `Your ${b.institute_name} account`,
        `Hello ${u.fullName},\n\nAn account has been created for you on the ${b.institute_name} learning platform. Choose your password using this link (valid for ${app.config.INVITE_HOURS} hours):\n\n${link}\n${emailFooter(b)}`]);
      await audit(tx, req, 'user.created', 'user', u.id, { role: body.role });
      return u;
    });
    return reply.code(201).send(user);
  });

  app.patch('/users/:id', perm('admin.users'), async (req) => {
    const { id } = idParams.parse(req.params);
    const body = userPatch.parse(req.body);
    return req.db(async (tx) => {
      const r = await svc.updateUser(tx, id, body);
      const changes: Record<string, unknown> = { fields: Object.keys(body) };
      if (r.before.role !== r.after.role) changes.role = { from: r.before.role, to: r.after.role };
      if (r.before.status !== r.after.status) changes.status = { from: r.before.status, to: r.after.status };
      await audit(tx, req, r.before.role !== r.after.role ? 'user.role_changed' : 'user.updated', 'user', id, changes);
      return { id, role: r.after.role, status: r.after.status };
    });
  });

  app.post('/users/:id/send-reset', { ...perm('admin.users'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const token = randomToken();
    await req.db(async (tx) => {
      const u = await tx.maybeOne<{ email: string; full_name: string; status: string }>('SELECT email, full_name, status FROM users WHERE id = $1', [id]);
      if (!u || u.status !== 'active') throw notFound('Active user');
      await tx.query('SELECT * FROM app.auth_create_reset($1, $2, $3::interval)', [u.email, sha256(token), `${app.config.PASSWORD_RESET_MINUTES} minutes`]);
      const b = await branding(tx);
      await tx.query('SELECT app.enqueue_email($1, $2, $3)', [u.email, `Reset your ${b.institute_name} password`,
        `Hello ${u.full_name},\n\nAn administrator sent you a password reset link. It expires in ${app.config.PASSWORD_RESET_MINUTES} minutes:\n\n${app.config.APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}\n${emailFooter(b)}`]);
      await audit(tx, req, 'user.reset_sent', 'user', id);
    });
    return reply.code(202).send({ message: 'Reset link sent' });
  });

  // ---------------------------------------------------------------- courses & enrolments
  app.get('/courses', perm('admin.courses'), async (req) => {
    const q = pageQuery.extend({
      search: z.string().trim().max(100).optional(),
      status: z.enum(['draft', 'published', 'archived']).optional(),
      termId: uuid.optional(),
    }).parse(req.query);
    return req.db((tx) => svc.listCourses(tx, q));
  });

  app.post('/courses', perm('admin.courses'), async (req, reply) => {
    const body = courseBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const c = await svc.createCourse(tx, body);
      await audit(tx, req, 'course.created', 'course', c.id, { code: body.code, status: body.status ?? 'draft' });
      return c;
    });
    return reply.code(201).send(row);
  });

  app.get('/courses/:id', perm('admin.courses'), async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.getCourseAdmin(tx, id));
  });

  app.patch('/courses/:id', perm('admin.courses'), async (req) => {
    const { id } = idParams.parse(req.params);
    const body = courseBody.partial().strict().parse(req.body);
    return req.db(async (tx) => {
      const r = await svc.updateCourseAdmin(tx, id, body);
      await audit(tx, req, body.status ? `course.status_${body.status}` : 'course.updated', 'course', id, { fields: Object.keys(body) });
      return r;
    });
  });

  app.delete('/courses/:id', perm('admin.courses'), async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await req.db(async (tx) => {
      await svc.deleteDraftCourse(tx, id);
      await audit(tx, req, 'course.deleted', 'course', id);
    });
    return reply.code(204).send();
  });

  app.put('/courses/:id/teachers/:userId', perm('admin.courses'), async (req) => {
    const { id, userId } = z.object({ id: uuid, userId: uuid }).parse(req.params);
    const { isLead } = z.object({ isLead: z.boolean().default(false) }).strict().parse(req.body ?? {});
    return req.db(async (tx) => {
      await tx.query(
        `INSERT INTO course_teachers (course_id, user_id, is_lead) VALUES ($1, $2, $3)
         ON CONFLICT (course_id, user_id) DO UPDATE SET is_lead = EXCLUDED.is_lead`, [id, userId, isLead]);
      await audit(tx, req, 'course.teacher_assigned', 'course', id, { userId, isLead });
      return { courseId: id, userId, isLead };
    });
  });

  app.delete('/courses/:id/teachers/:userId', perm('admin.courses'), async (req, reply) => {
    const { id, userId } = z.object({ id: uuid, userId: uuid }).parse(req.params);
    await req.db(async (tx) => {
      const r = await tx.maybeOne('DELETE FROM course_teachers WHERE course_id = $1 AND user_id = $2 RETURNING user_id', [id, userId]);
      if (!r) throw notFound('Teaching assignment');
      await audit(tx, req, 'course.teacher_removed', 'course', id, { userId });
    });
    return reply.code(204).send();
  });

  app.post('/courses/:id/enrollments', perm('admin.enrollments'), async (req) => {
    const { id } = idParams.parse(req.params);
    const { userIds } = z.object({ userIds: z.array(uuid).min(1).max(200) }).strict().parse(req.body);
    return req.db(async (tx) => {
      const results = await svc.enrollStudents(tx, id, [...new Set(userIds)]);
      await audit(tx, req, 'enrollment.admin_enrolled', 'course', id, { count: results.length });
      return { results };
    });
  });

  app.patch('/enrollments/:id', perm('admin.enrollments'), async (req) => {
    const { id } = idParams.parse(req.params);
    const { status } = z.object({ status: z.enum(['active', 'dropped', 'completed']) }).strict().parse(req.body);
    return req.db(async (tx) => {
      const r = await tx.maybeOne<{ course_id: string; user_id: string }>(
        'UPDATE enrollments SET status = $2 WHERE id = $1 RETURNING course_id, user_id', [id, status]);
      if (!r) throw notFound('Enrolment');
      await audit(tx, req, 'enrollment.status_changed', 'course', r.course_id, { userId: r.user_id, status });
      return { id, status };
    });
  });

  // Lookup used by the enrolment and teacher pickers (bounded, admin-only).
  app.get('/people', perm('admin.enrollments'), async (req) => {
    const q = z.object({ search: z.string().trim().min(1).max(100), role: z.enum(['student', 'teacher']) }).parse(req.query);
    return {
      items: await req.db((tx) => tx.query(
        `SELECT id, full_name AS "fullName", email FROM users
          WHERE role = $1 AND status = 'active' AND (full_name ILIKE $2 OR email::text ILIKE $2)
          ORDER BY full_name LIMIT 20`, [q.role, likePattern(q.search)])),
    };
  });

  // ---------------------------------------------------------------- academic structure
  app.get('/departments', perm('admin.structure'), async (req) => ({
    items: await req.db((tx) => tx.query(
      `SELECT d.id, d.code, d.name, (SELECT count(*) FROM courses c WHERE c.department_id = d.id)::int AS "courseCount"
         FROM departments d ORDER BY d.name`)),
  }));
  app.post('/departments', perm('admin.structure'), async (req, reply) => {
    const b = deptBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const r = await tx.one<{ id: string }>('INSERT INTO departments (code, name) VALUES ($1, $2) RETURNING id', [b.code, b.name]);
      await audit(tx, req, 'department.created', 'department', r.id, b);
      return r;
    });
    return reply.code(201).send(row);
  });
  app.patch('/departments/:id', perm('admin.structure'), async (req) => {
    const { id } = idParams.parse(req.params);
    const b = deptBody.partial().strict().parse(req.body);
    return req.db(async (tx) => {
      const r = await tx.maybeOne('UPDATE departments SET code = coalesce($2, code), name = coalesce($3, name) WHERE id = $1 RETURNING id', [id, b.code ?? null, b.name ?? null]);
      if (!r) throw notFound('Department');
      await audit(tx, req, 'department.updated', 'department', id, b);
      return r;
    });
  });
  app.delete('/departments/:id', perm('admin.structure'), async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await req.db(async (tx) => {
      const r = await tx.maybeOne('DELETE FROM departments WHERE id = $1 RETURNING id', [id]);
      if (!r) throw notFound('Department');
      await audit(tx, req, 'department.deleted', 'department', id);
    });
    return reply.code(204).send();
  });

  app.get('/terms', perm('admin.structure'), async (req) => ({
    items: await req.db((tx) => tx.query(
      `SELECT t.id, t.code, t.name, t.starts_on AS "startsOn", t.ends_on AS "endsOn",
              (SELECT count(*) FROM courses c WHERE c.term_id = t.id)::int AS "courseCount"
         FROM terms t ORDER BY t.starts_on DESC`)),
  }));
  app.post('/terms', perm('admin.structure'), async (req, reply) => {
    const b = termBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const r = await tx.one<{ id: string }>('INSERT INTO terms (code, name, starts_on, ends_on) VALUES ($1, $2, $3, $4) RETURNING id',
        [b.code, b.name, b.startsOn, b.endsOn]);
      await audit(tx, req, 'term.created', 'term', r.id, b);
      return r;
    });
    return reply.code(201).send(row);
  });
  app.delete('/terms/:id', perm('admin.structure'), async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await req.db(async (tx) => {
      const r = await tx.maybeOne('DELETE FROM terms WHERE id = $1 RETURNING id', [id]);
      if (!r) throw notFound('Term');
      await audit(tx, req, 'term.deleted', 'term', id);
    });
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- audit & settings
  app.get('/audit', perm('admin.audit'), async (req) => {
    const q = pageQuery.extend({
      action: z.string().regex(/^[a-z_.]{1,64}$/).optional(),
      actorId: uuid.optional(),
      entityType: z.string().regex(/^[a-z_]{1,40}$/).optional(),
    }).parse(req.query);
    return req.db((tx) => svc.listAudit(tx, q));
  });

  app.get('/settings', perm('admin.settings'), async (req) => {
    const rows = await req.db((tx) => tx.query<{ key: string; value: unknown; updated_at: Date | null }>(
      'SELECT key, value, updated_at FROM system_settings ORDER BY key'));
    return { settings: Object.fromEntries(rows.filter((r) => r.key in SETTINGS).map((r) => [r.key, r.value])) };
  });

  app.put('/settings', perm('admin.settings'), async (req) => {
    const body = settingsBody.parse(req.body);
    return req.db(async (tx) => {
      for (const [key, value] of Object.entries(body)) {
        await tx.query('UPDATE system_settings SET value = $2::jsonb, updated_by = app.uid() WHERE key = $1', [key, JSON.stringify(value)]);
      }
      await audit(tx, req, 'settings.updated', 'system_settings', null, { keys: Object.keys(body) });
      return { updated: Object.keys(body) };
    });
  });
}
