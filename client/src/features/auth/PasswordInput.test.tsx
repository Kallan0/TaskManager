import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PasswordInput } from './PasswordInput';

afterEach(() => vi.useRealTimers());

describe('Timed password visibility', () => {
  it.each(['current-password', 'new-password'])(
    'reveals %s for exactly five seconds and keeps the value',
    (autoComplete) => {
      vi.useFakeTimers();
      render(
        <PasswordInput
          id="password"
          aria-label="Password"
          autoComplete={autoComplete}
          defaultValue="my-private-password"
        />,
      );
      const input = screen.getByLabelText('Password');
      expect(input).toHaveAttribute('type', 'password');
      fireEvent.click(
        screen.getByRole('button', { name: 'Show password for 5 seconds' }),
      );
      expect(input).toHaveAttribute('type', 'text');
      act(() => vi.advanceTimersByTime(4999));
      expect(input).toHaveAttribute('type', 'text');
      act(() => vi.advanceTimersByTime(1));
      expect(input).toHaveAttribute('type', 'password');
      expect(input).toHaveValue('my-private-password');
      expect(input).toHaveAttribute('autocomplete', autoComplete);
    },
  );

  it('allows early hiding and gives a later reveal its own five seconds without submitting', () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    render(
      <form onSubmit={submit}>
        <PasswordInput aria-label="Password" />
      </form>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Show password for 5 seconds' }),
    );
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'type',
      'password',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Show password for 5 seconds' }),
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'type',
      'password',
    );
    expect(submit).not.toHaveBeenCalled();
  });
});
