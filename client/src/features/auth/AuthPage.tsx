import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowRight, Compass } from 'lucide-react';
import { ApiError, authApi } from '../../api/client';
import { useSession } from '../../hooks/useSession';
import { PasswordInput } from './PasswordInput';

const schema = z.object({
  name: z.string(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof schema>;
const backgroundWords = [
  'Mission',
  'On track',
  'Crew',
  'Approved',
  'Planning',
  'Group chat',
  'In review',
  'Completed',
  'Celestial',
  'Deadline',
  'Submitted',
  'Holy Knights',
  'Assigned',
  'Commoners',
  'Meeting',
  'Resolved',
  'Overdue',
  'Backlog',
];

function AuthBackground() {
  return (
    <div className="auth-ambient" aria-hidden="true">
      {Array.from({ length: 13 }, (_, row) => (
        <div className="auth-ambient-row" key={row}>
          {Array.from({ length: 18 }, (_, column) => (
            <span
              key={column}
              className={`ambient-word tone-${(row + column) % 6}`}
            >
              {backgroundWords[(row * 5 + column * 7) % backgroundWords.length]}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AuthPage({ register = false }: { register?: boolean }) {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const candidate = params.get('next') ?? '';
  const next = /^\/invitations\/[a-f\d]{64}$/.test(candidate)
    ? candidate
    : '/dashboard';
  const suffix =
    next === '/dashboard' ? '' : `?next=${encodeURIComponent(next)}`;
  const cache = useQueryClient();
  const [error, setError] = useState('');
  const {
    register: field,
    handleSubmit,
    setError: fieldError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });
  if (session.data) return <Navigate to={next} replace />;
  const submit = handleSubmit(async (values) => {
    setError('');
    if (register && values.name.trim().length < 2) {
      fieldError('name', { message: 'Enter at least 2 characters' });
      return;
    }
    if (register && values.password.length < 10) {
      fieldError('password', { message: 'Use at least 10 characters' });
      return;
    }
    if (new TextEncoder().encode(values.password).length > 72) {
      fieldError('password', {
        message: 'Password must be at most 72 UTF-8 bytes',
      });
      return;
    }
    try {
      const user = register
        ? await authApi.register(values)
        : await authApi.login({
            email: values.email,
            password: values.password,
          });
      await cache.cancelQueries({ queryKey: ['session'] });
      cache.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'session',
      });
      cache.setQueryData(['session'], user);
      navigate(next, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        caught.error.details?.forEach((detail) => {
          if (['name', 'email', 'password'].includes(detail.field))
            fieldError(detail.field as keyof Values, {
              message: detail.message,
            });
        });
      }
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not sign in. Please try again',
      );
    }
  });
  return (
    <main className="auth-layout">
      <AuthBackground />
      <section className="auth-form-area">
        <div className="auth-form">
          <Link to="/login" className="brand auth-brand">
            <Compass size={34} aria-hidden="true" />
            <span>Team Mission Planner</span>
          </Link>
          <h1>{register ? 'Create your account' : 'Welcome aboard.'}</h1>
          <p className="muted">
            {register
              ? 'Your next great project starts here.'
              : 'Sign in to your workspace and pick up the course.'}
          </p>
          <form onSubmit={submit} noValidate>
            {register && (
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input
                  id="name"
                  autoComplete="name"
                  maxLength={80}
                  placeholder="Alex Morgan"
                  {...field('name')}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? 'name-error' : undefined}
                />
                {errors.name && (
                  <small id="name-error" className="field-error">
                    {errors.name.message}
                  </small>
                )}
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                {...field('email')}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <small id="email-error" className="field-error">
                  {errors.email.message}
                </small>
              )}
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <PasswordInput
                key={register ? 'register-password' : 'login-password'}
                id="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder={
                  register ? 'At least 10 characters' : 'Enter your password'
                }
                {...field('password')}
                aria-invalid={!!errors.password}
                aria-describedby={
                  errors.password ? 'password-error' : undefined
                }
              />
              {errors.password && (
                <small id="password-error" className="field-error">
                  {errors.password.message}
                </small>
              )}
            </div>
            {error && (
              <div role="alert" className="error-box">
                {error}
              </div>
            )}
            <button className="primary full" disabled={isSubmitting}>
              <ArrowRight size={16} aria-hidden="true" />
              {isSubmitting
                ? 'Please wait…'
                : register
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>
          <div className="auth-switch">
            <p>
              {register
                ? 'Already have an account?'
                : 'New to Team Mission Planner?'}
            </p>
            <Link
              className="secondary full"
              to={`${register ? '/login' : '/register'}${suffix}`}
            >
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </div>
          <p className="auth-note">
            Start a crew, invite your people and set your first mission.
          </p>
        </div>
      </section>
    </main>
  );
}
