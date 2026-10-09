import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RecoveryPage } from './RecoveryPage';
import { authApi, ApiError } from '../api/client';
vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  authApi: { recover: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
function show() {
  render(
    <MemoryRouter>
      <RecoveryPage />
    </MemoryRouter>,
  );
}
describe('Recovery without email delivery', () => {
  it('replaces the form with a private replacement code after recovery', async () => {
    vi.mocked(authApi.recover).mockResolvedValue({
      recoveryCode: 'b'.repeat(64),
    });
    show();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'alex@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Saved recovery code'), {
      target: { value: 'a'.repeat(64) },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'replacement-password-123' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Reset password' }),
    );
    expect(await screen.findByLabelText('Recovery code')).toHaveValue(
      'b'.repeat(64),
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
  it('retains form inputs on a recovery failure', async () => {
    vi.mocked(authApi.recover).mockRejectedValue(
      new ApiError(400, {
        code: 'RECOVERY_FAILED',
        message: 'The recovery details are invalid',
      }),
    );
    show();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'alex@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Saved recovery code'), {
      target: { value: 'a'.repeat(64) },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'replacement-password-123' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Reset password' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The recovery details are invalid',
    );
    expect(screen.getByLabelText('Email address')).toHaveValue(
      'alex@example.com',
    );
  });
});
