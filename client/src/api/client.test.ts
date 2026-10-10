import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, clearPendingRequests } from './client';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearPendingRequests();
});
describe('Bounded network requests and retry identity', () => {
  it('explains that the backend is not connected for a frontend-only deployment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 503,
        ok: false,
        headers: new Headers({ 'X-Planner-Deployment': 'frontend-only' }),
        json: async () => {
          throw new SyntaxError('Vercel error page');
        },
      }),
    );
    await expect(
      request('/auth/login', { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({
      error: {
        code: 'BACKEND_NOT_CONNECTED',
        message: expect.stringContaining('frontend only'),
      },
    });
  });
  it('rejects HTML returned by a broken deployment route and retains the retry key', async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('HTML instead of JSON');
      },
    });
    vi.stubGlobal('fetch', fetch);
    const options = { method: 'POST', body: '{"name":"Crew"}' };
    await expect(request('/teams', options)).rejects.toMatchObject({
      status: 502,
      error: { code: 'INVALID_API_RESPONSE' },
    });
    await expect(request('/teams', options)).rejects.toMatchObject({
      error: { code: 'INVALID_API_RESPONSE' },
    });
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(
      fetch.mock.calls[1][1].headers['Idempotency-Key'],
    );
  });
  it('aborts a stalled request and exposes a recoverable timeout error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    const pending = request('/teams');
    const assertion = expect(pending).rejects.toMatchObject({
      error: { code: 'REQUEST_TIMED_OUT' },
    });
    await vi.advanceTimersByTimeAsync(12000);
    await assertion;
  });
  it('retains the same creation key after a lost response and releases it after success', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Lost response'))
      .mockResolvedValue({
        status: 201,
        ok: true,
        json: async () => ({ data: { id: 'created' } }),
      });
    vi.stubGlobal('fetch', fetch);
    const path = '/teams/' + 'a'.repeat(24) + '/tasks';
    const options = {
      method: 'POST',
      body: JSON.stringify({ title: 'Retry safely' }),
    };
    await expect(request(path, options)).rejects.toMatchObject({
      error: { code: 'NETWORK_ERROR' },
    });
    expect(await request(path, options)).toEqual({ id: 'created' });
    await request(path, options);
    const keys = fetch.mock.calls.map(
      (call) => call[1].headers['Idempotency-Key'],
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('never adds retry keys to login or invitation creation', async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: 201,
      ok: true,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal('fetch', fetch);
    await request('/auth/login', { method: 'POST', body: '{}' });
    await request('/teams/' + 'a'.repeat(24) + '/invitations', {
      method: 'POST',
      body: '{}',
    });
    expect(
      fetch.mock.calls.every((call) => !call[1].headers['Idempotency-Key']),
    ).toBe(true);
  });
});
