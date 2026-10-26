import type { Pool, Tx } from './db/pool.js';
import type { Config } from './config.js';
import type { Role, Permission } from './permissions/policy.js';
import type { FileStore } from './lib/storage.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
  csrfToken: string;
  email: string;
  fullName: string;
  preferredName: string | null;
  timezone: string;
  expiresAt: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    pool: Pool;
    files: FileStore;
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requirePermission: (permission: Permission) => (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
    /** Run queries in a transaction as the signed-in user (RLS identity). */
    db: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  }
}
