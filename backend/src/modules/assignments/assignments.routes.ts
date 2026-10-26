import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { idParams, text, uuid } from '../../lib/http.js';
import * as svc from './assignments.service.js';

const isoDate = z.string().datetime({ offset: true, message: 'Use a full date and time' });
const assignmentBody = z.object({
  title: text(3, 200),
  instructions: z.string().max(20000).optional(),
  dueAt: isoDate,
  lateUntil: isoDate.nullish(),
  pointsPossible: z.number().positive().max(1000).multipleOf(0.01),
  submissionType: z.enum(['text', 'file', 'text_or_file']).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  status: z.enum(['draft', 'published']).optional(),
}).strict();
const submitBody = z.object({
  body: z.string().max(100000).nullish(),
  fileId: uuid.nullish(),
  clientToken: uuid.optional(),
}).strict();
const gradeBody = z.object({
  score: z.number().min(0).max(1000).multipleOf(0.01),
  feedback: z.string().max(20000).optional(),
  expectedVersion: z.number().int().min(1).nullish(),
  release: z.boolean().optional(),
}).strict();
const studentParams = z.object({ id: uuid, studentId: uuid });

export default async function assignmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);
  const manage = { preHandler: app.requirePermission('assignments.manage') };
  const grade = { preHandler: app.requirePermission('grades.manage') };

  app.get('/courses/:id/assignments', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.listAssignments(tx, id, req.auth!));
  });

  app.post('/courses/:id/assignments', manage, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = assignmentBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const a = await svc.createAssignment(tx, id, body);
      await audit(tx, req, 'assignment.created', 'assignment', a.id, { courseId: id, status: a.status });
      return a;
    });
    return reply.code(201).send(row);
  });

  app.get('/assignments/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.getAssignment(tx, id, req.auth!));
  });

  app.patch('/assignments/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = assignmentBody.partial().strict().parse(req.body);
    return req.db(async (tx) => {
      const a = await svc.updateAssignment(tx, id, body);
      await audit(tx, req, 'assignment.updated', 'assignment', id, { fields: Object.keys(body) });
      return a;
    });
  });

  app.delete('/assignments/:id', manage, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await req.db(async (tx) => {
      const courseId = await svc.deleteAssignment(tx, id);
      await audit(tx, req, 'assignment.deleted', 'assignment', id, { courseId });
    });
    return reply.code(204).send();
  });

  app.post('/assignments/:id/submissions', {
    preHandler: app.requirePermission('assignments.submit'),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = submitBody.parse(req.body);
    const result = await req.db(async (tx) => {
      const r = await svc.submit(tx, id, req.auth!, body);
      if (!r.duplicate) await audit(tx, req, 'submission.created', 'assignment', id);
      return r;
    });
    return reply.code(result.duplicate ? 200 : 201).send(result.submission);
  });

  app.get('/assignments/:id/submissions', grade, async (req) => {
    const { id } = idParams.parse(req.params);
    return { items: await req.db((tx) => svc.gradingQueue(tx, id)) };
  });

  app.get('/assignments/:id/submissions/:studentId', grade, async (req) => {
    const { id, studentId } = studentParams.parse(req.params);
    return req.db((tx) => svc.studentWork(tx, id, studentId));
  });

  app.put('/assignments/:id/grades/:studentId', grade, async (req) => {
    const { id, studentId } = studentParams.parse(req.params);
    const body = gradeBody.parse(req.body);
    return req.db(async (tx) => {
      const g = await svc.saveGrade(tx, id, studentId, body);
      await audit(tx, req, 'grade.saved', 'assignment', id, { studentId, score: body.score, released: g.newlyReleased });
      return g;
    });
  });

  app.post('/assignments/:id/grades/release', grade, async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db(async (tx) => {
      const r = await svc.releaseAll(tx, id);
      await audit(tx, req, 'grade.released', 'assignment', id, { count: r.released });
      return r;
    });
  });
}
