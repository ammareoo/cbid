import type { FastifyRequest } from 'fastify';
import type { Tx } from '../db/pool.js';

/**
 * Append an audit record inside the caller's transaction, so the log entry commits
 * if and only if the audited change commits. The actor is taken from the DB identity
 * (app.uid()), never from a parameter.
 */
export async function audit(
  tx: Tx,
  req: FastifyRequest,
  action: string,
  entityType: string | null,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  await tx.query('SELECT app.audit($1, $2, $3, $4::jsonb, $5::inet)', [
    action,
    entityType,
    entityId,
    JSON.stringify(details),
    req.ip || null,
  ]);
}
