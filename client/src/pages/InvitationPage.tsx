import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers3, Mail } from 'lucide-react';
import { invitationsApi } from '../api/teams.api';
import { useSession } from '../hooks/useSession';
import { ErrorMessage } from '../components/common/Feedback';
import { roleLabels } from '../components/teams/crewTheme';
export function InvitationPage() {
  const { token = '' } = useParams();
  const session = useSession();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const valid = /^[a-f\d]{64}$/.test(token);
  const invitation = useQuery({
    queryKey: ['invitation', token, session.data?.id],
    queryFn: () => invitationsApi.get(token),
    enabled: !!session.data && valid,
    refetchInterval: 15000,
  });
  const response = useMutation({
    mutationFn: (action: 'accept' | 'decline') =>
      invitationsApi.respond(token, action, false),
    onSuccess: async (result) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['teams'] }),
        cache.invalidateQueries({ queryKey: ['incoming-invitations'] }),
        cache.invalidateQueries({ queryKey: ['invitation', token] }),
      ]);
      if (result.status === 'accepted')
        navigate(`/teams/${result.teamId}`, { replace: true });
    },
  });
  const next = encodeURIComponent(`/invitations/${token}`);
  return (
    <main className="invitation-page">
      <Link to="/dashboard" className="brand">
        <Layers3 size={26} />
        Team Mission Planner
      </Link>
      <section className="invitation-panel">
        <div className="empty-icon">
          <Mail size={30} />
        </div>
        <h1>You’re invited</h1>
        {!valid ? (
          <ErrorMessage error="This invitation link is invalid." />
        ) : session.isPending ? (
          <p role="status">Checking your session…</p>
        ) : session.isError ? (
          <>
            <ErrorMessage error={session.error} />
            <button
              className="secondary"
              onClick={() => void session.refetch()}
            >
              Try again
            </button>
          </>
        ) : !session.data ? (
          <>
            <p className="muted">
              Sign in or create an account using the email address that received
              this invitation.
            </p>
            <div className="action-row centered">
              <Link className="primary" to={`/login?next=${next}`}>
                Sign in
              </Link>
              <Link className="secondary" to={`/register?next=${next}`}>
                Create account
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Signed in as {session.data.email}</p>
            <ErrorMessage error={invitation.error || response.error} />
            {invitation.isPending && <p role="status">Loading invitation…</p>}
            {invitation.data && (
              <>
                <h2>{invitation.data.teamName}</h2>
                <p className="muted">
                  Invited as {roleLabels[invitation.data.role]} · Expires{' '}
                  {new Date(invitation.data.expiresAt).toLocaleString()}
                </p>
                {invitation.data.status === 'pending' ? (
                  <div className="action-row centered">
                    <button
                      className="secondary"
                      disabled={response.isPending}
                      onClick={() => response.mutate('decline')}
                    >
                      Decline
                    </button>
                    <button
                      className="primary"
                      disabled={response.isPending}
                      onClick={() => response.mutate('accept')}
                    >
                      {response.isPending ? 'Working…' : 'Request to join'}
                    </button>
                  </div>
                ) : invitation.data.status === 'requested' ? (
                  <p role="status" className="success-message">
                    Your request is awaiting Celestial approval. You will get
                    access after your identity is confirmed.
                  </p>
                ) : (
                  <p className="success-message" role="status">
                    This invitation is {invitation.data.status}.
                  </p>
                )}
              </>
            )}
            <Link className="back-link" to="/dashboard">
              Back to workspace
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
