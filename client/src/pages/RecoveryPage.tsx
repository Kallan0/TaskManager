import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/client';
import { PasswordInput } from '../features/auth/PasswordInput';
import { RecoveryCode } from '../features/auth/RecoveryCode';
import { ErrorMessage } from '../components/common/Feedback';
export function RecoveryPage() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <main className="invitation-page">
      <section className="invitation-panel">
        <h1>Recover your account</h1>
        <p>
          Use the private recovery code you saved. Recovery changes your
          password and signs out every device; your Celestial role and crews
          stay with your account.
        </p>
        <ErrorMessage error={error} />
        {code ? (
          <>
            <p role="status">
              Password changed. Save the replacement recovery code.
            </p>
            <RecoveryCode code={code} />
            <Link className="primary" to="/login">
              Sign in
            </Link>
          </>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setBusy(true);
              setError(undefined);
              try {
                setCode(
                  (
                    await authApi.recover({
                      email: String(data.get('email')),
                      recoveryCode: String(data.get('recoveryCode')).trim(),
                      password: String(data.get('password')),
                    })
                  ).recoveryCode,
                );
              } catch (caught) {
                setError(caught);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="field">
              <label htmlFor="recover-email">Email address</label>
              <input
                id="recover-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="recover-code">Saved recovery code</label>
              <input
                id="recover-code"
                name="recoveryCode"
                autoComplete="off"
                required
                minLength={64}
                maxLength={64}
              />
            </div>
            <div className="field">
              <label htmlFor="recover-password">New password</label>
              <PasswordInput
                id="recover-password"
                name="password"
                autoComplete="new-password"
                required
                minLength={10}
              />
            </div>
            <button className="primary" disabled={busy}>
              {busy ? 'Recovering…' : 'Reset password'}
            </button>
            <Link to="/login">Back to sign in</Link>
          </form>
        )}
      </section>
    </main>
  );
}
