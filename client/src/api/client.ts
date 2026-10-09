export type User = { id: string; name: string; email: string };
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
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}${path}`,
    {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    },
  );
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.error ?? {
        code: 'REQUEST_FAILED',
        message: 'Unable to reach the server. Please try again',
      },
    );
  return body.data;
}
export const authApi = {
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
