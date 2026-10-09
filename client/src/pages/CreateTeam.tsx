import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { TeamForm } from '../components/teams/TeamForm';
import { teamsApi } from '../api/teams.api';
export function CreateTeam() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  return (
    <WorkspaceLayout title="Create team">
      <Link className="back-link" to="/dashboard">
        ← Back to your teams
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">BUILD SOMETHING TOGETHER</span>
          <h1>Create a team</h1>
          <p className="muted">
            You’ll be the Celestial. Invite your crew and choose Holy Knights to
            help lead it.
          </p>
        </div>
      </div>
      <section className="content-panel form-panel">
        <TeamForm
          onSubmit={async (values) => {
            const team = await teamsApi.create(values);
            await cache.invalidateQueries({ queryKey: ['teams'] });
            navigate(`/teams/${team.id}`);
          }}
        />
      </section>
    </WorkspaceLayout>
  );
}
