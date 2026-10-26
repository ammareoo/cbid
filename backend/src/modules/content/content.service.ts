import type { Tx } from '../../db/pool.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import type { AuthContext } from '../../types.js';
import { requireStaff, requireVisible } from '../courses/courses.service.js';

export interface ItemInput {
  kind: 'page' | 'link' | 'file';
  title: string;
  body?: string | null;
  url?: string | null;
  fileId?: string | null;
  published?: boolean;
  estimatedMinutes?: number | null;
}

const itemCols = `i.id, i.module_id AS "moduleId", i.kind, i.title, i.url, i.file_id AS "fileId", i.position,
  i.published, i.estimated_minutes AS "estimatedMinutes", f.original_name AS "fileName", f.size_bytes AS "fileSize",
  f.mime_type AS "fileType"`;

export async function listModules(tx: Tx, courseId: string, auth: AuthContext) {
  const access = await requireVisible(tx, courseId);
  const modules = await tx.query<{ id: string; title: string; description: string; position: number; published: boolean; items?: unknown[] }>(
    `SELECT id, title, description, position, published FROM modules WHERE course_id = $1 ORDER BY position, created_at`,
    [courseId],
  );
  const items = await tx.query<{ moduleId: string; completed: boolean }>(
    `SELECT ${itemCols}, EXISTS (SELECT 1 FROM item_completions ic WHERE ic.item_id = i.id AND ic.user_id = $2) AS completed
       FROM module_items i
       JOIN modules m ON m.id = i.module_id
       LEFT JOIN files f ON f.id = i.file_id
      WHERE m.course_id = $1
      ORDER BY i.position, i.created_at`,
    [courseId, auth.userId],
  );
  for (const m of modules) m.items = items.filter((i) => i.moduleId === m.id);
  return { modules, isStaff: access.isStaff, writable: access.writable };
}

async function nextPosition(tx: Tx, table: 'modules' | 'module_items', parentCol: string, parentId: string) {
  const r = await tx.one<{ p: number }>(`SELECT coalesce(max(position) + 1, 0)::int AS p FROM ${table} WHERE ${parentCol} = $1`, [parentId]);
  return r.p;
}

export async function createModule(tx: Tx, courseId: string, input: { title: string; description?: string; published?: boolean }) {
  await requireStaff(tx, courseId, { write: true });
  const position = await nextPosition(tx, 'modules', 'course_id', courseId);
  return tx.one(
    `INSERT INTO modules (course_id, title, description, published, position) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, description, position, published`,
    [courseId, input.title, input.description ?? '', input.published ?? false, position],
  );
}

async function moduleCourse(tx: Tx, moduleId: string) {
  const m = await tx.maybeOne<{ course_id: string }>('SELECT course_id FROM modules WHERE id = $1', [moduleId]);
  if (!m) throw notFound('Module');
  return m.course_id;
}

export async function updateModule(tx: Tx, moduleId: string, patch: { title?: string; description?: string; published?: boolean }) {
  await requireStaff(tx, await moduleCourse(tx, moduleId), { write: true });
  return tx.one(
    `UPDATE modules SET title = coalesce($2, title), description = coalesce($3, description), published = coalesce($4, published)
      WHERE id = $1 RETURNING id, title, description, position, published`,
    [moduleId, patch.title ?? null, patch.description ?? null, patch.published ?? null],
  );
}

export async function deleteModule(tx: Tx, moduleId: string) {
  const courseId = await moduleCourse(tx, moduleId);
  await requireStaff(tx, courseId, { write: true });
  await tx.query('DELETE FROM modules WHERE id = $1', [moduleId]);
  return courseId;
}

/** Keyboard/screen-reader friendly reordering (alternative to drag-and-drop): swap with a neighbour. */
export async function moveModule(tx: Tx, moduleId: string, direction: 'up' | 'down') {
  const courseId = await moduleCourse(tx, moduleId);
  await requireStaff(tx, courseId, { write: true });
  await renumber(tx, 'modules', 'course_id', courseId);
  return swap(tx, 'modules', 'course_id', courseId, moduleId, direction);
}

async function renumber(tx: Tx, table: 'modules' | 'module_items', parentCol: string, parentId: string) {
  await tx.query(
    `UPDATE ${table} t SET position = r.rn FROM (
       SELECT id, (row_number() OVER (ORDER BY position, created_at) - 1)::int AS rn FROM ${table} WHERE ${parentCol} = $1
     ) r WHERE t.id = r.id AND t.position <> r.rn`,
    [parentId],
  );
}

async function swap(tx: Tx, table: 'modules' | 'module_items', parentCol: string, parentId: string, id: string, direction: 'up' | 'down') {
  const rows = await tx.query<{ id: string; position: number }>(
    `SELECT id, position FROM ${table} WHERE ${parentCol} = $1 ORDER BY position FOR UPDATE`, [parentId]);
  const idx = rows.findIndex((r) => r.id === id);
  const other = rows[direction === 'up' ? idx - 1 : idx + 1];
  const self = rows[idx];
  if (!self || !other) return { moved: false };
  await tx.query(`UPDATE ${table} SET position = $2 WHERE id = $1`, [self.id, other.position]);
  await tx.query(`UPDATE ${table} SET position = $2 WHERE id = $1`, [other.id, self.position]);
  return { moved: true };
}

function validateItem(input: ItemInput) {
  if (input.kind === 'page' && !input.body?.trim()) throw unprocessable('A page needs some content');
  if (input.kind === 'link' && !input.url) throw unprocessable('A link needs a URL');
  if (input.kind === 'file' && !input.fileId) throw unprocessable('Attach a file first');
}

export async function createItem(tx: Tx, moduleId: string, input: ItemInput) {
  validateItem(input);
  await requireStaff(tx, await moduleCourse(tx, moduleId), { write: true });
  const position = await nextPosition(tx, 'module_items', 'module_id', moduleId);
  const r = await tx.one<{ id: string }>(
    `INSERT INTO module_items (module_id, kind, title, body, url, file_id, published, estimated_minutes, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [moduleId, input.kind, input.title, input.kind === 'page' ? input.body : null, input.kind === 'link' ? input.url : null,
     input.kind === 'file' ? input.fileId : null, input.published ?? false, input.estimatedMinutes ?? null, position],
  );
  return r;
}

async function itemCourse(tx: Tx, itemId: string) {
  const r = await tx.maybeOne<{ course_id: string; module_id: string }>(
    'SELECT m.course_id, i.module_id FROM module_items i JOIN modules m ON m.id = i.module_id WHERE i.id = $1', [itemId]);
  if (!r) throw notFound('Item');
  return r;
}

export async function updateItem(tx: Tx, itemId: string, patch: Partial<ItemInput>) {
  const { course_id } = await itemCourse(tx, itemId);
  await requireStaff(tx, course_id, { write: true });
  const cur = await tx.one<ItemInput>('SELECT kind, title, body, url, file_id AS "fileId", published, estimated_minutes AS "estimatedMinutes" FROM module_items WHERE id = $1', [itemId]);
  const next: ItemInput = { ...cur, ...patch, kind: cur.kind };
  validateItem(next);
  await tx.query(
    `UPDATE module_items SET title = $2, body = $3, url = $4, file_id = $5, published = $6, estimated_minutes = $7 WHERE id = $1`,
    [itemId, next.title, next.kind === 'page' ? next.body : null, next.kind === 'link' ? next.url : null,
     next.kind === 'file' ? next.fileId : null, next.published ?? false, next.estimatedMinutes ?? null],
  );
  return { id: itemId };
}

export async function deleteItem(tx: Tx, itemId: string) {
  const { course_id } = await itemCourse(tx, itemId);
  await requireStaff(tx, course_id, { write: true });
  await tx.query('DELETE FROM module_items WHERE id = $1', [itemId]);
  return course_id;
}

export async function moveItem(tx: Tx, itemId: string, direction: 'up' | 'down') {
  const { course_id, module_id } = await itemCourse(tx, itemId);
  await requireStaff(tx, course_id, { write: true });
  await renumber(tx, 'module_items', 'module_id', module_id);
  return swap(tx, 'module_items', 'module_id', module_id, itemId, direction);
}

export async function getItem(tx: Tx, itemId: string, auth: AuthContext) {
  const item = await tx.maybeOne<Record<string, unknown> & { moduleId: string; courseId: string }>(
    `SELECT ${itemCols}, i.body, m.title AS "moduleTitle", m.course_id AS "courseId", c.title AS "courseTitle", c.code AS "courseCode",
            EXISTS (SELECT 1 FROM item_completions ic WHERE ic.item_id = i.id AND ic.user_id = $2) AS completed
       FROM module_items i JOIN modules m ON m.id = i.module_id JOIN courses c ON c.id = m.course_id
       LEFT JOIN files f ON f.id = i.file_id
      WHERE i.id = $1`,
    [itemId, auth.userId],
  );
  if (!item) throw notFound('Item');
  // Ordered sequence across the course for previous/next navigation (only items the caller can see).
  const seq = await tx.query<{ id: string; title: string }>(
    `SELECT i.id, i.title FROM module_items i JOIN modules m ON m.id = i.module_id
      WHERE m.course_id = $1 ORDER BY m.position, m.created_at, i.position, i.created_at`,
    [item.courseId],
  );
  const idx = seq.findIndex((s) => s.id === itemId);
  return { ...item, previous: seq[idx - 1] ?? null, next: seq[idx + 1] ?? null };
}

export async function setCompletion(tx: Tx, itemId: string, auth: AuthContext, complete: boolean) {
  const vis = await tx.maybeOne('SELECT id FROM module_items WHERE id = $1', [itemId]);
  if (!vis) throw notFound('Item');
  if (complete) {
    await tx.query('INSERT INTO item_completions (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [auth.userId, itemId]);
  } else {
    await tx.query('DELETE FROM item_completions WHERE user_id = $1 AND item_id = $2', [auth.userId, itemId]);
  }
  return { completed: complete };
}
