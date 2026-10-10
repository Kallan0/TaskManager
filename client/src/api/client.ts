export type User = {
  id: string;
  name: string;
  email: string;
  recoveryCode?: string;
};
type Failure = {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public error: Failure['error'],
  ) {
    super(error.message);
  }
}
const pendingCreates = new Map<string, { key: string; expires: number }>();
export function clearPendingRequests() {
  pendingCreates.clear();
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 12000);
  const eligible =
    options.method === 'POST' &&
    /^\/teams(?:$|\/[a-f\d]{24}\/tasks(?:$|\/proposals$|\/[a-f\d]{24}\/comments$))/.test(
      path,
    );
  const fingerprint = path + ':' + String(options.body ?? '');
  let key: string | undefined;
  if (eligible) {
    for (const [id, entry] of pendingCreates)
      if (entry.expires < Date.now()) pendingCreates.delete(id);
    key = pendingCreates.get(fingerprint)?.key ?? crypto.randomUUID();
    if (pendingCreates.size >= 100)
      pendingCreates.delete(pendingCreates.keys().next().value!);
    pendingCreates.set(fingerprint, { key, expires: Date.now() + 600000 });
  }
  try {
    const response = await fetch(
      (import.meta.env.VITE_API_BASE_URL || '/api/v1') + path,
      {
        ...options,
        signal: controller.signal,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
          ...options.headers,
        },
      },
    );
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (
        eligible &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      )
        pendingCreates.delete(fingerprint);
      throw new ApiError(
        response.status,
        body?.error ?? {
          code:
            response.headers?.get('X-Planner-Deployment') === 'frontend-only'
              ? 'BACKEND_NOT_CONNECTED'
              : 'REQUEST_FAILED',
          message:
            response.headers?.get('X-Planner-Deployment') === 'frontend-only'
              ? 'This site currently hosts the frontend only. The backend is not connected yet.'
              : 'Unable to reach the server. Please try again',
        },
      );
    }
    if (!body || typeof body !== 'object' || !('data' in body))
      throw new ApiError(502, {
        code: 'INVALID_API_RESPONSE',
        message:
          'The server returned an unexpected response. Please try again.',
      });
    if (eligible) pendingCreates.delete(fingerprint);
    return body.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, {
      code: controller.signal.aborted ? 'REQUEST_TIMED_OUT' : 'NETWORK_ERROR',
      message: controller.signal.aborted
        ? 'Request timed out. Your draft is safe; retry to check or complete the request.'
        : 'Connection lost. Please try again.',
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
export const authApi = {
  recover: (values: {
    email: string;
    password: string;
    recoveryCode: string;
  }) =>
    request<{ recoveryCode: string }>('/auth/recover', {
      method: 'POST',
      body: JSON.stringify(values),
    }),
  recoveryCode: (password: string) =>
    request<{ recoveryCode: string }>('/auth/recovery-code', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  me: () => request<User>('/auth/me'),
  login: (values: { email: string; password: string }) =>
    request<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(values),
    }),
  register: (values: { name: string; email: string; password: string }) =>
    request<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(values),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};
