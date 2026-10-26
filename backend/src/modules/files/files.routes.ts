import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { idParams } from '../../lib/http.js';
import { contentDisposition } from '../../lib/security.js';
import { can } from '../../permissions/policy.js';
import { courseAccess } from '../courses/courses.service.js';

const uploadQuery = z.object({ purpose: z.enum(['material', 'submission']) });
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg']);

export default async function fileRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  app.post('/courses/:id/files', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: courseId } = idParams.parse(req.params);
    const { purpose } = uploadQuery.parse(req.query);
    const auth = req.auth!;
    if (!can(auth.role, purpose === 'submission' ? 'files.upload_submission' : 'files.upload_material')) throw forbidden();

    // Authorise BEFORE accepting bytes onto disk.
    await req.db(async (tx) => {
      const access = await courseAccess(tx, courseId);
      if (purpose === 'submission' && !(access.isLearner && access.status === 'published')) throw notFound('Course');
      if (purpose === 'material' && !(access.isStaff && access.writable)) throw notFound('Course');
    });

    if (!req.isMultipart()) throw badRequest('Send the file as multipart/form-data');
    const part = await req.file();
    if (!part) throw badRequest('No file was attached');
    const stored = await app.files.save(part.file, part.filename, purpose);

    try {
      const row = await req.db(async (tx) => {
        const r = await tx.one<{ id: string }>(
          `INSERT INTO files (owner_id, course_id, purpose, storage_key, original_name, mime_type, size_bytes, sha256)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [auth.userId, courseId, purpose, stored.storageKey, stored.originalName, stored.mimeType, stored.sizeBytes, stored.sha256],
        );
        await audit(tx, req, 'file.uploaded', 'file', r.id, { courseId, purpose, size: stored.sizeBytes, type: stored.mimeType });
        return r;
      });
      return reply.code(201).send({
        id: row.id, originalName: stored.originalName, sizeBytes: stored.sizeBytes, mimeType: stored.mimeType,
      });
    } catch (err) {
      await app.files.remove(stored.storageKey);
      throw err;
    }
  });

  app.get('/files/:id', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const inline = (req.query as { inline?: string }).inline === '1';
    // RLS (app.can_read_file) decides visibility: owner, course staff, or learners who can see the module item.
    const file = await req.db((tx) =>
      tx.maybeOne<{ storage_key: string; original_name: string; mime_type: string }>(
        'SELECT storage_key, original_name, mime_type FROM files WHERE id = $1', [id]),
    );
    if (!file) throw notFound('File');
    const { stream, size } = await app.files.open(file.storage_key);
    reply
      .header('Content-Type', file.mime_type)
      .header('Content-Length', size)
      .header('Content-Disposition', contentDisposition(file.original_name, inline && INLINE_TYPES.has(file.mime_type)))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, no-store');
    return reply.send(stream);
  });
}
