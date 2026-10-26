import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, qs, setCsrfToken, setUnauthorizedHandler } from '../../src/api/client';
import { formatBytes, fromLocalInput, initials, percent, setDisplayTimeZone, toLocalInput } from '../../src/utils/format';
import { uuid } from '../../src/utils/id';

describe('time zone conversion for date inputs', () => {
  it('round-trips a Karachi local time through UTC', () => {
    setDisplayTimeZone('Asia/Karachi');
    const iso = fromLocalInput('2026-10-22T17:00');
    expect(iso).toBe('2026-10-22T12:00:00.000Z'); // PKT is UTC+5
    expect(toLocalInput(iso)).toBe('2026-10-22T17:00');
  });
  it('handles a zone with daylight saving', () => {
    setDisplayTimeZone('Europe/London');
    expect(fromLocalInput('2026-07-01T09:30')).toBe('2026-07-01T08:30:00.000Z');
    expect(fromLocalInput('2026-12-01T09:30')).toBe('2026-12-01T09:30:00.000Z');
    setDisplayTimeZone('Asia/Karachi');
  });
});

describe('formatting helpers', () => {
  it('computes percentages and sizes', () => {
    expect(percent(18, 20)).toBe(90);
    expect(percent(null, 20)).toBeNull();
    expect(percent(5, 0)).toBeNull();
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1048576)).toBe('3.0 MB');
  });
  it('builds initials without honorifics', () => {
    expect(initials('Dr. Sana Mirza')).toBe('SM');
    expect(initials('Amina Khan')).toBe('AK');
  });
  it('builds query strings without empty values', () => {
    expect(qs({ a: 1, b: '', c: undefined, d: 'x y' })).toBe('?a=1&d=x+y');
    expect(qs({})).toBe('');
  });
  it('creates v4 ids', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('API client', () => {
  afterEach(() => { vi.restoreAllMocks(); setCsrfToken(null); setUnauthorizedHandler(null); });

  const respond = (status: number, body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('sends the CSRF token on state-changing requests only', async () => {
    const f = respond(200, { ok: true });
    setCsrfToken('tok-123');
    await api.get('/x');
    await api.post('/y', { a: 1 });
    const [, getInit] = f.mock.calls[0]!;
    const [, postInit] = f.mock.calls[1]!;
    expect((getInit!.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined();
    expect((postInit!.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok-123');
    expect(postInit!.credentials).toBe('same-origin');
  });

  it('turns error responses into ApiError with field details', async () => {
    respond(400, { error: { code: 'validation_error', message: 'Some fields need attention', details: [{ path: 'title', message: 'Too short' }] } });
    const err = (await api.post('/z', {}).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.fieldErrors).toEqual({ title: 'Too short' });
  });

  it('notifies the app when the session has expired', async () => {
    respond(401, { error: { code: 'unauthorized', message: 'Please sign in to continue' } });
    const onExpired = vi.fn();
    setUnauthorizedHandler(onExpired);
    await api.get('/me/dashboard').catch(() => undefined);
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it('reports network failures in plain language', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await api.get('/x').catch((e) => e)) as ApiError;
    expect(err.code).toBe('network_error');
    expect(err.message).toMatch(/could not reach the server/);
  });
});
