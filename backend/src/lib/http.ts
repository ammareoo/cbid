import { z, type ZodTypeAny } from 'zod';
import type { FastifyRequest } from 'fastify';

export const uuid = z.string().uuid({ message: 'Must be a valid id' });
export const idParams = z.object({ id: uuid });

/** Bounded pagination: callers can never request unbounded result sets. */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuery>;

export const offset = (q: PageQuery) => (q.page - 1) * q.pageSize;

export function paged<T>(items: T[], total: number, q: PageQuery) {
  return { items, page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

export const parse = <S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> => schema.parse(value);

/** Trimmed, length-bounded text. */
export const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Escape LIKE wildcards in user search terms. */
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

export const clientIp = (req: FastifyRequest) => req.ip;
