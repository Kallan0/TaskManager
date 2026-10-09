import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Plus, Users } from 'lucide-react';
import { teamsApi, invitationsApi } from '../api/teams.api';
import { useSession } from '../hooks/useSession';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { roleLabels } from '../components/teams/crewTheme';
import {
  ErrorMessage,
  Pagination,
  LoadingState,
} from '../components/common/Feedback';
import { TeamForm } from '../components/teams/TeamForm';
export function Dashboard() {
  const { data: user } = useSession();
  const [page, setPage] = useState(1);
  const [invitePage, setInvitePage] = useState(1);
  const teams = useQuery({
    queryKey: ['teams', page],
    queryFn: () => teamsApi.list(page),
  });
  const invitations = useQuery({
    queryKey: ['incoming-invitations', invitePage],
    queryFn: () => invitationsApi.incoming(invitePage),
  });
  const cache = useQueryClient();
  const navigate = useNavigate();
  const response = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: 'accept' | 'decline';
    }) => invitationsApi.respond(id, action),
    onSuccess: async (result) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['teams'] }),
        cache.invalidateQueries({ queryKey: ['incoming-invitations'] }),
      ]);
      if (result.status === 'accepted') navigate(`/teams/${result.teamId}`);
    },
  });
  return (
    <WorkspaceLayout>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>Your command center</h1>
          <p className="muted">
            Welcome back, {user?.name.split(' ')[0]}. Your crews and
            invitations, all in one place.
          </p>
        </div>
        <Link className="primary" to="/teams/new">
          <Plus size={17} />
          Create team
        </Link>
      </div>
      <section className="command-banner" aria-label="Workspace overview">
        <div>
          <span className="eyebrow">READY FOR YOUR NEXT CHAPTER</span>
          <h2>A shared course. Plenty of possibility.</h2>
        </div>
        <div className="command-totals">
          <div>
            <strong>{teams.data?.total ?? '—'}</strong>
            <span>YOUR TEAMS</span>
          </div>
          <div>
            <strong>{invitations.data?.total ?? '—'}</strong>
            <span>PENDING INVITES</span>
          </div>
        </div>
      </section>
      <div className="section-heading">
        <h2>Your teams</h2>
        <span>
          {teams.data
            ? `${teams.data.total} ${teams.data.total === 1 ? 'team' : 'teams'}`
            : ''}
        </span>
      </div>
      <ErrorMessage error={teams.error} />
      {teams.isPending && <LoadingState label="Loading your teams…" />}
      {teams.data?.total === 0 && (
        <section className="empty-panel">
          <div className="empty-icon">
            <Users size={30} />
          </div>
          <h2>Your first team starts here</h2>
          <p>
            Create a team and invite people to collaborate. Teams you join will
            appear here too.
          </p>
          <Link className="primary" to="/teams/new">
            Create your first team
          </Link>
        </section>
      )}
      <section className="team-grid">
        {teams.data?.items.map((team) => (
          <Link
            to={`/teams/${team.id}/tasks`}
            className="team-card"
            key={team.id}
          >
            <div className="team-card-top">
              <span className="team-monogram">
                {team.name[0].toUpperCase()}
              </span>
              <span className={`role-badge ${team.role}`}>
                {roleLabels[team.role]}
              </span>
            </div>
            <h2>{team.name}</h2>
            <p>{team.description || 'No description yet.'}</p>
            <span className="team-card-members">
              {team.memberCount == null
                ? 'Crew workspace'
                : `${team.memberCount} ${team.memberCount === 1 ? 'crew member' : 'crew members'}`}
            </span>
            <span className="team-card-bottom">
              View missions & comments <ArrowUpRight size={16} />
            </span>
          </Link>
        ))}
      </section>
      {teams.data && (
        <Pagination page={page} pages={teams.data.pages} onChange={setPage} />
      )}
      <div className="dashboard-lower">
        <section className="content-panel invitation-inbox">
          <div className="section-heading">
            <h2>Invitations for you</h2>
            <span>{invitations.data?.total ?? 0} pending</span>
          </div>
          <ErrorMessage error={invitations.error} />
          <ErrorMessage error={response.error} />
          {response.data?.status === 'declined' && (
            <p role="status" className="success-message">
              Invitation declined.
            </p>
          )}
          {invitations.isPending && (
            <LoadingState label="Loading invitations…" cards={1} />
          )}
          {invitations.data?.total === 0 && (
            <div className="content-panel muted">
              No pending invitations. You’re up to date.
            </div>
          )}
          <div className="invitation-list">
            {invitations.data?.items.map((invite) => (
              <article key={invite.id} className="incoming-card">
                <div>
                  <h3>{invite.teamName}</h3>
                  <p>
                    Join as {roleLabels[invite.role]} · Expires{' '}
                    {new Date(invite.expiresAt).toLocaleString()}
                  </p>
                </div>
                <div className="action-row">
                  <button
                    className="secondary"
                    disabled={response.isPending}
                    onClick={() =>
                      response.mutate({ id: invite.id, action: 'decline' })
                    }
                  >
                    Decline
                  </button>
                  <button
                    className="primary"
                    disabled={response.isPending}
                    onClick={() =>
                      response.mutate({ id: invite.id, action: 'accept' })
                    }
                  >
                    {response.isPending && response.variables?.id === invite.id
                      ? 'Working…'
                      : 'Accept invitation'}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {invitations.data && (
            <Pagination
              page={invitePage}
              pages={invitations.data.pages}
              onChange={setInvitePage}
            />
          )}
          <p className="inbox-note">
            Accept to join the crew. Each new invitation expires 48 hours after
            creation.
          </p>
        </section>
        <section className="content-panel dashboard-create">
          <h2 className="panel-title">Start your own crew</h2>
          <p className="muted small-text">
            Choose a familiar crew name, or chart your own course.
          </p>
          <TeamForm
            onSubmit={async (values) => {
              const saved = await teamsApi.create(values);
              await cache.invalidateQueries({ queryKey: ['teams'] });
              navigate(`/teams/${saved.id}/tasks`);
            }}
          />
        </section>
      </div>
    </WorkspaceLayout>
  );
}
