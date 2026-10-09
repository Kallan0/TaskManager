import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { teamsApi } from '../api/teams.api';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { TeamNavigation } from '../components/teams/TeamNavigation';
import { MissionProposals } from '../components/tasks/MissionProposals';
import {
  ErrorMessage,
  LoadingState,
  EmptyState,
} from '../components/common/Feedback';

export function MissionProposalsPage() {
  const { teamId = '' } = useParams();
  const team = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId),
  });
  return (
    <WorkspaceLayout title="Mission proposals">
      <Link className="back-link" to={`/teams/${teamId}/tasks`}>
        ← Mission workspace
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CREW / PROPOSAL REVIEW</span>
          <h1>Ideas today. Missions tomorrow.</h1>
          <p className="muted">
            Holy Knights propose the course. The Celestial gives the go-ahead.
          </p>
        </div>
      </div>
      <ErrorMessage error={team.error} />
      {team.isPending && <LoadingState label="Loading proposals…" />}
      {team.data && (
        <>
          <TeamNavigation teamId={teamId} />
          {team.data.role === 'member' ? (
            <EmptyState
              title="Mission workspace"
              description="Approved missions and their discussions are available in your mission list."
            >
              <Link className="primary" to={`/teams/${teamId}/tasks`}>
                View approved missions
              </Link>
            </EmptyState>
          ) : (
            <MissionProposals teamId={teamId} />
          )}
        </>
      )}
    </WorkspaceLayout>
  );
}
