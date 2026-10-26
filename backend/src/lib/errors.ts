import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Please sign in to continue') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have permission to do that') => new AppError(403, 'forbidden', msg);
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);
export const unprocessable = (msg: string) => new AppError(422, 'unprocessable', msg);

interface PgError {
  code?: string;
  message: string;
  constraint?: string;
}

const isPgError = (e: unknown): e is PgError =>
  typeof e === 'object' && e !== null && 'code' in e && typeof (e as PgError).code === 'string' && 'severity' in e;

/** Maps database errors to safe HTTP errors. Only messages we authored (CBxxx) are shown verbatim. */
export function fromDbError(err: unknown): AppError | null {
  if (!isPgError(err)) return null;
  switch (err.code) {
    case 'CB403':
      return new AppError(403, 'forbidden', err.message);
    case 'CB404':
      return new AppError(404, 'not_found', err.message);
    case 'CB409':
      return new AppError(409, 'conflict', err.message);
    case 'CB422':
      return new AppError(422, 'unprocessable', err.message);
    case '42501': // insufficient_privilege, incl. "new row violates row-level security policy"
      return forbidden();
    case '23505':
      return conflict('A record with these details already exists');
    case '23503':
      return conflict('This record is linked to other records and cannot be changed that way');
    case '23514':
    case '23502':
      return unprocessable('One or more values are not valid');
    case '22P02':
    case '22007':
    case '22008':
      return badRequest('Malformed value in request');
    case '57014':
      return new AppError(503, 'timeout', 'The request took too long. Please try again.');
    default:
      return null;
  }
}

export function toPublicError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(
      400,
      'validation_error',
      'Some fields need attention',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const db = fromDbError(err);
  if (db) return db;
  const status = (err as { statusCode?: number })?.statusCode;
  if (status === 429) return new AppError(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.');
  if (status === 413) return new AppError(413, 'payload_too_large', 'That upload is too large');
  if (status === 415) return new AppError(415, 'unsupported_media_type', 'Unsupported content type');
  if (status && status >= 400 && status < 500) {
    return new AppError(status, 'bad_request', 'The request could not be processed');
  }
  return new AppError(500, 'internal_error', 'Something went wrong on our side. Please try again.');
}
