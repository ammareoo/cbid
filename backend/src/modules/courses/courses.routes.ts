import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { idParams, pageQuery, text, uuid } from '../../lib/http.js';
import * as svc from './courses.service.js';

const listQuery = pageQuery.extend({
  scope: z.enum(['mine', 'catalogue']).default('mine'),
  search: z.string().trim().max(100).optional(),
  departmentId: uuid.optional(),
  mode: z.enum(['online', 'blended', 'onsite']).optional(),
});
const patchBody = z
  .object({ title: text(3, 160), summary: z.string().trim().max(500), description: z.string().max(20000) })
  .partial()
  .strict();

export default async function courseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (req) => {
    const q = listQuery.parse(req.query);
    if (q.scope === 'catalogue') return req.db((tx) => svc.catalogue(tx, q));
    return { items: await req.db((tx) => svc.myCourses(tx, req.auth!)) };
  });

  app.get('/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.courseDetail(tx, id, req.auth!));
  });

  app.patch('/:id', { preHandler: app.requirePermission('content.manage') }, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = patchBody.parse(req.body);
    return req.db(async (tx) => {
      const row = await svc.updateCourseContent(tx, id, body);
      await audit(tx, req, 'course.content_updated', 'course', id, { fields: Object.keys(body) });
      return row;
    });
  });

  app.post('/:id/enroll', { preHandler: app.requirePermission('courses.self_enroll'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const row = await req.db(async (tx) => {
      const r = await svc.selfEnroll(tx, id, req.auth!);
      await audit(tx, req, 'enrollment.self_enrolled', 'course', id);
      return r;
    });
    return reply.code(201).send(row);
  });

  app.post('/:id/withdraw', { preHandler: app.requirePermission('courses.self_enroll') }, async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db(async (tx) => {
      const r = await svc.withdraw(tx, id, req.auth!);
      await audit(tx, req, 'enrollment.self_withdrew', 'course', id);
      return r;
    });
  });

  app.get('/:id/students', { preHandler: app.requirePermission('roster.view') }, async (req) => {
    const { id } = idParams.parse(req.params);
    return { items: await req.db((tx) => svc.roster(tx, id)) };
  });

  app.get('/:id/gradebook', { preHandler: app.requirePermission('grades.manage') }, async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.gradebook(tx, id));
  });

  app.get('/:id/my-grades', { preHandler: app.requirePermission('grades.view_own') }, async (req) => {
    const { id } = idParams.parse(req.params);
    return { items: await req.db((tx) => svc.myCourseGrades(tx, id, req.auth!)) };
  });
}
