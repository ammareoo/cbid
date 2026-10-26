import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { idParams, text, uuid } from '../../lib/http.js';
import * as svc from './content.service.js';

const moduleBody = z.object({
  title: text(2, 160),
  description: z.string().trim().max(2000).optional(),
  published: z.boolean().optional(),
}).strict();
const httpsUrl = z.string().trim().url().max(2000).refine((u) => u.startsWith('https://'), 'Links must start with https://');
const itemBody = z.object({
  kind: z.enum(['page', 'link', 'file']),
  title: text(2, 200),
  body: z.string().max(50000).nullish(),
  url: httpsUrl.nullish(),
  fileId: uuid.nullish(),
  published: z.boolean().optional(),
  estimatedMinutes: z.number().int().min(1).max(600).nullish(),
}).strict();
const itemPatch = itemBody.omit({ kind: true }).partial().strict();
const moveBody = z.object({ direction: z.enum(['up', 'down']) }).strict();

export default async function contentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);
  const manage = { preHandler: app.requirePermission('content.manage') };

  app.get('/courses/:id/modules', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.listModules(tx, id, req.auth!));
  });

  app.post('/courses/:id/modules', manage, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = moduleBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const m = await svc.createModule(tx, id, body);
      await audit(tx, req, 'module.created', 'course', id, { title: body.title });
      return m;
    });
    return reply.code(201).send(row);
  });

  app.patch('/modules/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = moduleBody.partial().parse(req.body);
    return req.db((tx) => svc.updateModule(tx, id, body));
  });

  app.post('/modules/:id/move', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const { direction } = moveBody.parse(req.body);
    return req.db((tx) => svc.moveModule(tx, id, direction));
  });

  app.delete('/modules/:id', manage, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await req.db(async (tx) => {
      const courseId = await svc.deleteModule(tx, id);
      await audit(tx, req, 'module.deleted', 'course', courseId, { moduleId: id });
    });
    return reply.code(204).send();
  });

  app.post('/modules/:id/items', manage, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = itemBody.parse(req.body);
    const row = await req.db((tx) => svc.createItem(tx, id, body));
    return reply.code(201).send(row);
  });

  app.get('/items/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.getItem(tx, id, req.auth!));
  });

  app.patch('/items/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = itemPatch.parse(req.body);
    return req.db((tx) => svc.updateItem(tx, id, body));
  });

  app.post('/items/:id/move', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const { direction } = moveBody.parse(req.body);
    return req.db((tx) => svc.moveItem(tx, id, direction));
  });

  app.delete('/items/:id', manage, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await req.db(async (tx) => {
      const courseId = await svc.deleteItem(tx, id);
      await audit(tx, req, 'item.deleted', 'course', courseId, { itemId: id });
    });
    return reply.code(204).send();
  });

  app.post('/items/:id/complete', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.setCompletion(tx, id, req.auth!, true));
  });

  app.delete('/items/:id/complete', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.setCompletion(tx, id, req.auth!, false));
  });
}
