import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { idParams, text, uuid } from '../../lib/http.js';
import * as svc from './certificates.service.js';

const issueBody = z.object({ userId: uuid }).strict();
const revokeBody = z.object({ reason: text(3, 300) }).strict();
// CBID-2026-ABCD2345. Lower case and surrounding spaces are accepted and normalised.
const serialParams = z.object({
  serial: z.string().trim().toUpperCase().regex(/^CBID-[0-9]{4}-[A-HJ-NP-Z2-9]{8}$/, 'Enter a serial like CBID-2026-ABCD2345'),
});

export default async function certificateRoutes(app: FastifyInstance) {
  // Public verification. Strictly rate-limited so serials cannot be guessed at speed.
  app.get('/verify/:serial', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { serial } = serialParams.parse(req.params);
    return req.db((tx) => svc.verify(tx, serial));
  });

  app.get('/certificates', { preHandler: [app.requireAuth, app.requirePermission('certificates.view_own')] }, async (req) => {
    return { items: await req.db((tx) => svc.mine(tx, req.auth!.userId)) };
  });

  app.get('/certificates/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.getOne(tx, id));
  });

  app.get('/courses/:id/certificates', { preHandler: [app.requireAuth, app.requirePermission('certificates.manage')] }, async (req) => {
    const { id } = idParams.parse(req.params);
    return req.db((tx) => svc.forCourse(tx, id));
  });

  app.post('/courses/:id/certificates', { preHandler: [app.requireAuth, app.requirePermission('certificates.manage')] }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { userId } = issueBody.parse(req.body);
    const cert = await req.db(async (tx) => {
      const c = await svc.issue(tx, id, userId);
      await audit(tx, req, 'certificate.issued', 'certificate', c.id, { courseId: id, userId, serial: c.serial });
      return c;
    });
    return reply.code(201).send(cert);
  });

  app.post('/certificates/:id/revoke', { preHandler: [app.requireAuth, app.requirePermission('certificates.manage')] }, async (req) => {
    const { id } = idParams.parse(req.params);
    const { reason } = revokeBody.parse(req.body);
    return req.db(async (tx) => {
      const r = await svc.revoke(tx, id, reason);
      await audit(tx, req, 'certificate.revoked', 'certificate', id, { courseId: r.courseId });
      return r;
    });
  });
}
