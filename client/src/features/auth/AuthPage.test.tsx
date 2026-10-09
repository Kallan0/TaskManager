import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthPage } from './AuthPage';
import { ApiError, authApi } from '../../api/client';

vi.mock('../../api/client', async (original) => ({
  ...(await original<typeof import('../../api/client')>()),
  authApi: { me: vi.fn(), login: vi.fn(), register: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.me).mockResolvedValue(null as never);
});
function show(register = false) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <AuthPage register={register} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
describe('Authentication forms', () => {
  it('shows validation without calling the API', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('Enter a valid email address'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });
  it('rejects short registration passwords', async () => {
    show(true);
    await userEvent.type(screen.getByLabelText('Full name'), 'Alex');
    await userEvent.type(
      screen.getByLabelText('Email address'),
      'alex@example.com',
    );
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    );
    expect(
      await screen.findByText('Use at least 10 characters'),
    ).toBeInTheDocument();
    expect(authApi.register).not.toHaveBeenCalled();
  });
  it('shows server errors and permits retry', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError(401, {
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      }),
    );
    show();
    await userEvent.type(
      screen.getByLabelText('Email address'),
      'alex@example.com',
    );
    await userEvent.type(
      screen.getByLabelText('Password'),
      'incorrect-password',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email or password is incorrect',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
  it('stores only the public user in query cache after sign-in', async () => {
    const user = { id: 'abc', name: 'Alex', email: 'alex@example.com' };
    vi.mocked(authApi.login).mockResolvedValue(user);
    const cache = show();
    await userEvent.type(
      screen.getByLabelText('Email address'),
      'alex@example.com',
    );
    await userEvent.type(screen.getByLabelText('Password'), 'correct-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(cache.getQueryData(['session'])).toEqual(user));
  });
});
