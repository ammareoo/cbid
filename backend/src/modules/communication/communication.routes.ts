import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { forbidden } from '../../lib/errors.js';
import { idParams, pageQuery, text, uuid } from '../../lib/http.js';
import { can } from '../../permissions/policy.js';
import * as svc from './communication.service.js';

const isoDate = z.string().datetime({ offset: true });
const announcementBody = z.object({ title: text(3, 200), body: text(1, 20000), notify: z.boolean().optional() }).strict();
const eventBody = z.object({
  title: text(2, 200),
  description: z.string().max(2000).optional(),
  location: z.string().trim().max(200).nullish(),
  startsAt: isoDate,
  endsAt: isoDate,
}).strict();

export default async function communicationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/announcements', async (req) => {
    const q = pageQuery.extend({ courseId: uuid.optional() }).parse(req.query);
    return req.db((tx) => svc.announcementFeed(tx, req.auth!, q));
  });

  app.post('/courses/:id/announcements', { preHandler: app.requirePermission('announcements.course') }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = announcementBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const r = await svc.postCourseAnnouncement(tx, id, req.auth!, body);
      await audit(tx, req, 'announcement.created', 'announcement', r.id, { courseId: id });
      return r;
    });
    return reply.code(201).send(row);
  });

  app.post('/announcements', { preHandler: app.requirePermission('announcements.global') }, async (req, reply) => {
    const body = announcementBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const r = await svc.postGlobalAnnouncement(tx, req.auth!, body);
      await audit(tx, req, 'announcement.global_created', 'announcement', r.id);
      return r;
    });
    return reply.code(201).send(row);
  });

  app.delete('/announcements/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    if (!can(req.auth!.role, 'announcements.course')) throw forbidden();
    await req.db(async (tx) => {
      const r = await svc.deleteAnnouncement(tx, id);
      await audit(tx, req, 'announcement.deleted', 'announcement', id, { courseId: r.course_id });
    });
    return reply.code(204).send();
  });

  app.get('/notifications', async (req) => {
    const q = pageQuery.extend({ unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true') }).parse(req.query);
    return req.db((tx) => svc.notifications(tx, req.auth!, q));
  });
  app.get('/notifications/unread-count', async (req) => req.db((tx) => svc.unreadCount(tx, req.auth!)));
  app.post('/notifications/:id/read', async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.markRead(tx, req.auth!, id));
  });
  app.post('/notifications/read-all', async (req) => req.db((tx) => svc.markRead(tx, req.auth!)));

  app.get('/calendar', async (req) => {
    const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    return { items: await req.db((tx) => svc.calendar(tx, req.auth!, new Date(q.from), new Date(q.to))) };
  });

  app.post('/courses/:id/events', { preHandler: app.requirePermission('content.manage') }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = eventBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const r = await svc.createEvent(tx, id, body);
      await audit(tx, req, 'event.created', 'calendar_event', r.id, { courseId: id });
      return r;
    });
    return reply.code(201).send(row);
  });

  app.post('/events', { preHandler: app.requirePermission('admin.structure') }, async (req, reply) => {
    const body = eventBody.parse(req.body);
    const row = await req.db(async (tx) => {
      const r = await svc.createEvent(tx, null, body);
      await audit(tx, req, 'event.created', 'calendar_event', r.id);
      return r;
    });
    return reply.code(201).send(row);
  });

  app.delete('/events/:id', { preHandler: app.requirePermission('content.manage') }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await req.db(async (tx) => {
      await svc.deleteEvent(tx, id);
      await audit(tx, req, 'event.deleted', 'calendar_event', id);
    });
    return reply.code(204).send();
  });
}
