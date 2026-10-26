import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, setupContext, teardown, type Ctx } from '../helpers.js';

let ctx: Ctx;
// Production defaults: 10 sign-in attempts per minute, 5 recovery requests per 15 minutes.
beforeAll(async () => { ctx = await setupContext({ AUTH_RATE_LIMIT_PER_MINUTE: '10', RECOVERY_RATE_LIMIT: '5' }); });
afterAll(async () => { await teardown(ctx); });

const post = (url: string, payload: unknown) =>
  ctx.app.inject({ method: 'POST', url, payload: payload as never, headers: { origin: ORIGIN } });

describe('rate limiting', () => {
  it('limits repeated sign-in attempts from one client', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post('/api/auth/login', { email: 'nobody@cbid.example', password: 'x-x-x-x-x-x' })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it('limits password recovery requests', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post('/api/auth/password/forgot', { email: 'someone@cbid.example' })).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 202)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});
