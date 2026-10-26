import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/** 256-bit random token, URL-safe. Used for sessions, CSRF and reset links. */
export const randomToken = () => randomBytes(32).toString('base64url');

export const sha256 = (value: string) => createHash('sha256').update(value).digest();

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// OWASP Password Storage Cheat Sheet: Argon2id, m=19 MiB, t=2, p=1 (minimum recommended).
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// Used to keep login timing similar whether or not the account exists.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword('not-a-real-password-' + randomToken());
  await verifyPassword(await dummyHash, password);
}

const COMMON = new Set([
  'password', 'password1', 'password123', '123456789', '1234567890', 'qwertyuiop', 'iloveyou', 'letmein123',
  'welcome123', 'admin12345', 'university', 'cbiduniversity', 'cbidinstitute', 'cbidnetwork', 'institute', 'pakistan123', 'karachi123', 'abc123456789',
]);

/** Returns a user-facing problem, or null when the password is acceptable (NIST SP 800-63B style). */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 128) return 'Use 128 characters or fewer';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common. Choose something less predictable.';
  if (/^(.)\1+$/.test(password)) return 'Avoid repeating a single character';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'Do not include your email name in your password';
  return null;
}

/** Content-Disposition with a safe ASCII fallback and RFC 5987 UTF-8 filename. */
export function contentDisposition(filename: string, inline = false): string {
  const cleaned = filename.replace(/[\r\n"\\/]/g, '_').slice(0, 200) || 'download';
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}
