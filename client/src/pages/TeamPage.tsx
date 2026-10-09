import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Users, UserPlus } from 'lucide-react';
import { teamsApi, type Invitation, type Team } from '../api/teams.api';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { TeamForm } from '../components/teams/TeamForm';
import {
  ErrorMessage,
  Pagination,
  LoadingState,
} from '../components/common/Feedback';
import { useSession } from '../hooks/useSession';
import { TeamNavigation } from '../components/teams/TeamNavigation';
import { roleLabels } from '../components/teams/crewTheme';

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Enter a valid email address')),
  role: z.enum(['admin', 'member']),
});
function InviteForm({
  team,
  refresh,
}: {
  team: Team;
  refresh: () => Promise<unknown>;
}) {
  const [created, setCreated] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'member' },
  });
  const invitation = useMutation({
    mutationFn: (values: z.infer<typeof inviteSchema>) =>
      teamsApi.invite(team.id, values),
    onSuccess: async (result) => {
      setCreated(result);
      setCopied(false);
      setCopyError('');
      reset();
      await refresh();
    },
  });
  return (
    <>
      <form
        noValidate
        onSubmit={handleSubmit((values) => {
          setCreated(null);
          invitation.mutate(values);
        })}
      >
        <div className="field">
          <label htmlFor="invite-email">Email address</label>
          <input
            id="invite-email"
            type="email"
            autoComplete="email"
            placeholder="teammate@company.com"
            {...register('email')}
            aria-invalid={!!errors.email}
          />
          {errors.email && (
            <small className="field-error">{errors.email.message}</small>
          )}
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" {...register('role')}>
            <option value="member">{roleLabels.member}</option>
            {team.role === 'owner' && (
              <option value="admin">{roleLabels.admin}</option>
            )}
          </select>
        </div>
        <ErrorMessage error={invitation.error} />
        <button className="primary" disabled={invitation.isPending}>
          <UserPlus size={16} />
          {invitation.isPending ? 'Creating invitation…' : 'Invite member'}
        </button>
      </form>
      {created && (
        <div className="invite-success" role="status">
          <strong>Invitation link ready.</strong>
          <p>
            For {created.email}. Valid for 48 hours. Expires{' '}
            {new Date(created.expiresAt).toLocaleString()}.
          </p>
          {created.inviteUrl && (
            <>
              <label htmlFor="invite-link">
                Copy this link and share it through WhatsApp, email or any other
                app.
              </label>
              <input
                id="invite-link"
                readOnly
                value={created.inviteUrl}
                onFocus={(event) => event.target.select()}
              />
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(created.inviteUrl!);
                    setCopied(true);
                  } catch {
                    setCopyError('Select and copy the invitation link above.');
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <div className="action-row invite-share-actions">
                <a
                  className="secondary"
                  href={`https://wa.me/?text=${encodeURIComponent(`Join ${team.name}: ${created.inviteUrl}\nSign in with ${created.email}. This invitation is valid for 48 hours.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Share on WhatsApp
                </a>
                <a
                  className="secondary"
                  href={`mailto:${encodeURIComponent(created.email)}?subject=${encodeURIComponent(`Invitation to ${team.name}`)}&body=${encodeURIComponent(`Join ${team.name}: ${created.inviteUrl}\n\nSign in with ${created.email}. This invitation expires at ${new Date(created.expiresAt).toLocaleString()} (48 hours after creation).`)}`}
                >
                  Share by email
                </a>
              </div>
              <ErrorMessage error={copyError} />
            </>
          )}
        </div>
      )}
    </>
  );
}
export function TeamPage() {
  const { teamId = '' } = useParams();
  const { data: user } = useSession();
  const cache = useQueryClient();
  const [memberPage, setMemberPage] = useState(1);
  const [invitePage, setInvitePage] = useState(1);
  const team = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId),
  });
  const members = useQuery({
    queryKey: ['members', teamId, memberPage],
    queryFn: () => teamsApi.members(teamId, memberPage),
    enabled: !!team.data,
  });
  const manager = team.data?.role === 'owner' || team.data?.role === 'admin';
  const invites = useQuery({
    queryKey: ['team-invitations', teamId, invitePage],
    queryFn: () => teamsApi.invitations(teamId, invitePage),
    enabled: manager,
  });
  async function refresh() {
    await Promise.all(
      [
        'team',
        'members',
        'team-invitations',
        'teams',
        'incoming-invitations',
        'tasks',
        'task',
        'task-summary',
        'task-assignees',
        'task-activity',
        'team-activity',
        'mission-comments',
        'mission-proposals',
      ].map((key) =>
        cache.invalidateQueries({
          queryKey:
            key === 'teams' || key === 'incoming-invitations'
              ? [key]
              : [key, teamId],
        }),
      ),
    );
  }
  const roleChange = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'admin' | 'member' }) =>
      teamsApi.changeRole(teamId, id, role),
    onSuccess: refresh,
  });
  const removal = useMutation({
    mutationFn: (id: string) => teamsApi.remove(teamId, id),
    onSuccess: refresh,
  });
  const approval = useMutation({
    mutationFn: ({ id, applicantId }: { id: string; applicantId: string }) =>
      teamsApi.approve(teamId, id, applicantId),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => teamsApi.revoke(teamId, id),
    onSuccess: refresh,
  });
  const busy =
    roleChange.isPending ||
    removal.isPending ||
    revoke.isPending ||
    approval.isPending;
  return (
    <WorkspaceLayout title={team.data?.name ?? 'Team'}>
      <Link to="/dashboard" className="back-link">
        ← All teams
      </Link>
      <ErrorMessage error={team.error} />
      {team.isPending && <LoadingState label="Loading team…" />}
      {team.data && (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">TEAM WORKSPACE</span>
              <h1>{team.data.name}</h1>
              <p className="muted">
                {team.data.description || 'A shared space for your team.'}
              </p>
            </div>
            <span className={`role-badge ${team.data.role}`}>
              {roleLabels[team.data.role]}
            </span>
          </div>
          <div className="team-summary">
            <Users size={20} />
            <strong>
              {team.data.memberCount}{' '}
              {team.data.memberCount === 1 ? 'member' : 'members'}
            </strong>
            <span>Invite people and manage your team here.</span>
          </div>
          <TeamNavigation teamId={teamId} />
          <p className="crew-role-guide">
            The Celestial leads the team and appoints Holy Knights as co-admins.
            Commoners are the crew members.
          </p>
          <div className={`team-content-grid ${manager ? '' : 'single'}`}>
            <div>
              <section className="content-panel">
                <div className="section-heading panel-heading">
                  <h2>Team members</h2>
                  <span>People you work with</span>
                </div>
                <ErrorMessage error={members.error} />
                <ErrorMessage error={roleChange.error || removal.error} />
                {members.isPending && (
                  <LoadingState label="Loading members…" cards={1} />
                )}
                <div className="member-list">
                  {members.data?.items.map((member) => (
                    <article className="member-row" key={member.id}>
                      <span className="avatar">
                        {member.name[0].toUpperCase()}
                      </span>
                      <div className="member-info">
                        <strong>
                          {member.name}
                          {member.id === user?.id ? ' (you)' : ''}
                        </strong>
                        <small>{member.email}</small>
                      </div>
                      <div className="member-actions">
                        {team.data?.role === 'owner' &&
                        member.role !== 'owner' ? (
                          <select
                            aria-label={`Role for ${member.name}`}
                            value={member.role}
                            disabled={busy}
                            onChange={(event) =>
                              roleChange.mutate({
                                id: member.id,
                                role: event.target.value as 'member' | 'admin',
                              })
                            }
                          >
                            <option value="member">{roleLabels.member}</option>
                            <option value="admin">{roleLabels.admin}</option>
                          </select>
                        ) : (
                          <span className={`role-badge ${member.role}`}>
                            {roleLabels[member.role]}
                          </span>
                        )}
                        {member.role !== 'owner' &&
                          (team.data?.role === 'owner' ||
                            (team.data?.role === 'admin' &&
                              member.role === 'member')) && (
                            <button
                              className="danger-text"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Remove ${member.name} from this team? They will lose access.`,
                                  )
                                )
                                  removal.mutate(member.id);
                              }}
                            >
                              Remove
                            </button>
                          )}
                      </div>
                    </article>
                  ))}
                </div>
                {members.data && (
                  <Pagination
                    page={memberPage}
                    pages={members.data.pages}
                    onChange={setMemberPage}
                  />
                )}
              </section>
              {manager && (
                <section className="content-panel">
                  <div className="section-heading panel-heading">
                    <h2>Invitations</h2>
                    <span>Pending and past</span>
                  </div>
                  <ErrorMessage
                    error={invites.error || revoke.error || approval.error}
                  />
                  {invites.isPending && (
                    <LoadingState label="Loading invitations…" cards={1} />
                  )}
                  {invites.data?.total === 0 && (
                    <p className="muted">
                      No invitations yet. Invite your first teammate.
                    </p>
                  )}
                  <div className="sent-invitations">
                    {invites.data?.items.map((invite) => (
                      <article className="sent-invite" key={invite.id}>
                        <div>
                          <strong>{invite.email}</strong>
                          <small>
                            {roleLabels[invite.role]} · Expires{' '}
                            {new Date(invite.expiresAt).toLocaleString()}
                          </small>
                        </div>
                        <span className={`status-badge ${invite.status}`}>
                          {invite.status}
                        </span>
                        {invite.status === 'requested' &&
                          invite.applicant &&
                          team.data?.role === 'owner' && (
                            <div>
                              <p>
                                {invite.applicant.name} (
                                {invite.applicant.email}) requested access.
                                Confirm this person through your trusted contact
                                before approving.
                              </p>
                              <button
                                className="primary"
                                disabled={approval.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      'Have you independently confirmed this account belongs to the intended person?',
                                    )
                                  )
                                    approval.mutate({
                                      id: invite.id,
                                      applicantId: invite.applicant!.id,
                                    });
                                }}
                              >
                                Confirm crew member
                              </button>
                            </div>
                          )}
                        {['pending', 'requested'].includes(invite.status) && (
                          <button
                            className="danger-text"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Revoke the invitation for ${invite.email}?`,
                                )
                              )
                                revoke.mutate(invite.id);
                            }}
                          >
                            Revoke
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                  {invites.data && (
                    <Pagination
                      page={invitePage}
                      pages={invites.data.pages}
                      onChange={setInvitePage}
                    />
                  )}
                </section>
              )}
            </div>
            {manager && (
              <div>
                <section className="content-panel">
                  <h2 className="panel-title">Invite a teammate</h2>
                  <p className="muted small-text">
                    Invitations are tied to the recipient’s email and expire
                    after 48 hours. Create a link and share it with your
                    teammate.
                  </p>
                  <InviteForm team={team.data} refresh={refresh} />
                </section>
                <section className="content-panel">
                  <h2 className="panel-title">Team settings</h2>
                  <TeamForm
                    key={team.data.id}
                    initial={{
                      name: team.data.name,
                      description: team.data.description,
                    }}
                    label="Save settings"
                    onSubmit={async (values) => {
                      await teamsApi.update(teamId, values);
                      await refresh();
                    }}
                  />
                </section>
              </div>
            )}
          </div>
        </>
      )}
    </WorkspaceLayout>
  );
}
