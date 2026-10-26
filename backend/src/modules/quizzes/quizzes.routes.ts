import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { idParams, text, uuid } from '../../lib/http.js';
import * as svc from './quizzes.service.js';

const isoDate = z.string().datetime({ offset: true, message: 'Use a full date and time' });
const question = z.object({
  kind: z.enum(['single', 'multiple', 'short']),
  prompt: text(1, 5000),
  points: z.number().positive().max(100).multipleOf(0.01),
  options: z.array(z.object({ label: text(1, 1000), correct: z.boolean() }).strict()).max(8).optional(),
  acceptedAnswers: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
}).strict();
const quizBody = z.object({
  title: text(3, 200),
  description: z.string().max(5000).optional(),
  timeLimitMinutes: z.number().int().min(1).max(600).nullish(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  opensAt: isoDate,
  closesAt: isoDate,
  status: z.enum(['draft', 'published']).optional(),
  questions: z.array(question).max(100).optional(),
}).strict();
const answerBody = z.object({
  selectedOptionIds: z.array(uuid).max(8).optional(),
  textAnswer: z.string().max(2000).nullish(),
}).strict();
const answerParams = z.object({ id: uuid, questionId: uuid });

export default async function quizRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);
  const manage = { preHandler: app.requirePermission('quizzes.manage') };
  const take = { preHandler: app.requirePermission('quizzes.take') };

  app.get('/courses/:id/quizzes', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.listQuizzes(tx, id, req.auth!));
  });

  app.post('/courses/:id/quizzes', manage, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = quizBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const q = await svc.createQuiz(tx, id, body);
      await audit(tx, req, 'quiz.created', 'quiz', q.id, { courseId: id });
      return q;
    });
    return reply.code(201).send(row);
  });

  app.get('/quizzes/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.getQuiz(tx, id, req.auth!));
  });

  app.patch('/quizzes/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = quizBody.partial().strict().parse(req.body);
    return req.db(async (tx) => {
      const r = await svc.updateQuiz(tx, id, body);
      await audit(tx, req, 'quiz.updated', 'quiz', id, { fields: Object.keys(body) });
      return r;
    });
  });

  app.delete('/quizzes/:id', manage, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await req.db(async (tx) => {
      const courseId = await svc.deleteQuiz(tx, id);
      await audit(tx, req, 'quiz.deleted', 'quiz', id, { courseId });
    });
    return reply.code(204).send();
  });

  app.get('/quizzes/:id/results', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    return { items: await req.db((tx) => svc.quizResults(tx, id)) };
  });

  app.post('/quizzes/:id/attempts', { ...take, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const attemptId = await req.db(async (tx) => {
      const a = await svc.startAttempt(tx, id);
      await audit(tx, req, 'quiz.attempt_started', 'quiz', id, { attemptId: a });
      return a;
    });
    return reply.code(201).send({ id: attemptId });
  });

  app.get('/attempts/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.getAttempt(tx, id, req.auth!));
  });

  app.put('/attempts/:id/answers/:questionId', { ...take, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req) => {
    const { id, questionId } = answerParams.parse(req.params);
    const body = answerBody.parse(req.body);
    return req.db((tx) => svc.saveAnswer(tx, id, questionId, body));
  });

  app.post('/attempts/:id/submit', take, async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db(async (tx) => {
      const r = await svc.submitAttempt(tx, id);
      await audit(tx, req, 'quiz.attempt_submitted', 'quiz_attempt', id, { score: r.score });
      return { score: r.score, maxScore: r.max_score };
    });
  });
}
