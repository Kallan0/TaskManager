import { useState } from 'react';
import { authApi } from '../api/client';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { PasswordInput } from '../features/auth/PasswordInput';
import { RecoveryCode } from '../features/auth/RecoveryCode';
import { ErrorMessage } from '../components/common/Feedback';
export function AccountPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  return (
    <WorkspaceLayout title="Account">
      <section className="content-panel form-panel">
        <h1>Account recovery</h1>
        <p>
          Generate a private recovery code if you did not save one. Generating a
          replacement invalidates your previous code.
        </p>
        <p>
          The Celestial keeps control of the crew after account recovery. Sign
          out currently signs out every device.
        </p>
        <ErrorMessage error={error} />
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            setBusy(true);
            setError(undefined);
            try {
              setCode(
                (await authApi.recoveryCode(String(data.get('password'))))
                  .recoveryCode,
              );
              form.reset();
            } catch (caught) {
              setError(caught);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="field">
            <label htmlFor="current-password">Current password</label>
            <PasswordInput
              id="current-password"
              name="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="primary" disabled={busy}>
            {busy ? 'Generating…' : 'Generate recovery code'}
          </button>
        </form>
        {code && <RecoveryCode code={code} />}
      </section>
    </WorkspaceLayout>
  );
}
