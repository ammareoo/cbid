import type { Tx } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { branding } from '../../lib/branding.js';
import { requireStaff, roster } from '../courses/courses.service.js';

const certColumns = `c.id, c.serial, c.course_id AS "courseId", c.user_id AS "userId", c.recipient_name AS "recipientName",
  c.course_code AS "courseCode", c.course_title AS "courseTitle", c.issued_at AS "issuedAt",
  c.revoked_at AS "revokedAt"`;

/** A learner's own certificates (RLS limits rows to the caller). */
export async function mine(tx: Tx, userId: string) {
  return tx.query(`SELECT ${certColumns} FROM certificates c WHERE c.user_id = $1 ORDER BY c.issued_at DESC`, [userId]);
}

/** One certificate, visible to its holder and to the course's staff. */
export async function getOne(tx: Tx, id: string) {
  const cert = await tx.maybeOne<Record<string, unknown>>(
    `SELECT ${certColumns}, c.revoke_reason AS "revokeReason",
            (SELECT u.full_name FROM users u WHERE u.id = c.issued_by) AS "issuedByName"
       FROM certificates c WHERE c.id = $1`, [id]);
  if (!cert) throw notFound('Certificate');
  return { ...cert, branding: await branding(tx) };
}

/** Staff view: enrolled learners with progress and grades, plus every certificate issued for the course. */
export async function forCourse(tx: Tx, courseId: string) {
  await requireStaff(tx, courseId);
  const learners = await roster(tx, courseId);
  const certificates = await tx.query(
    `SELECT ${certColumns}, c.revoke_reason AS "revokeReason" FROM certificates c WHERE c.course_id = $1 ORDER BY c.issued_at DESC`,
    [courseId]);
  return { learners, certificates };
}

export async function issue(tx: Tx, courseId: string, userId: string) {
  await requireStaff(tx, courseId);
  const { id } = await tx.one<{ id: string }>('SELECT app.issue_certificate($1, $2) AS id', [courseId, userId]);
  return tx.one<{ id: string; serial: string }>('SELECT id, serial FROM certificates WHERE id = $1', [id]);
}

export async function revoke(tx: Tx, id: string, reason: string) {
  await tx.query('SELECT app.revoke_certificate($1, $2)', [id, reason]);
  return tx.one<{ id: string; courseId: string; revokedAt: string }>(
    'SELECT id, course_id AS "courseId", revoked_at AS "revokedAt" FROM certificates WHERE id = $1', [id]);
}

export async function verify(tx: Tx, serial: string) {
  const row = await tx.maybeOne<Record<string, unknown>>(
    `SELECT serial, recipient_name AS "recipientName", course_code AS "courseCode", course_title AS "courseTitle",
            issued_at AS "issuedAt", valid, revoked_at AS "revokedAt"
       FROM app.verify_certificate($1)`, [serial]);
  if (!row) throw notFound('Certificate');
  const b = await branding(tx);
  return { ...row, issuer: b.institute_name, organisation: b.organisation_name };
}
