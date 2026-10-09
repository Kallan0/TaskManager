import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Compass,
  Anchor,
  Columns3,
  Users,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Plus,
} from 'lucide-react';
import { clearPageCursors } from '../../api/pagination';
import { authApi, ApiError, clearPendingRequests } from '../../api/client';
import { useSession } from '../../hooks/useSession';
import { ErrorMessage } from '../common/Feedback';
import { teamsApi } from '../../api/teams.api';
import { roleLabels } from '../teams/crewTheme';
export function WorkspaceLayout({
  children,
  title = 'Overview',
}: {
  children: ReactNode;
  title?: string;
}) {
  const { data: user } = useSession();
  const { teamId } = useParams();
  const team = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId!),
    enabled: !!teamId,
  });
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await authApi.logout();
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.status === 401)) {
        setError(caught);
        setBusy(false);
        return;
      }
    }
    clearPendingRequests();
    clearPageCursors();
    await cache.cancelQueries();
    cache.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'session',
    });
    cache.setQueryData(['session'], null);
    navigate('/login', { replace: true });
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link to="/dashboard" className="brand">
          <Compass size={30} />
          <span>
            Team Mission <br />
            Planner
          </span>
        </Link>
        <span className="nav-label">WORKSPACE</span>
        <NavLink
          to="/dashboard"
          className={({ isActive }) => (isActive ? 'nav-active' : 'nav-item')}
        >
          <LayoutDashboard size={18} />
          Overview
        </NavLink>
        <NavLink
          to="/teams/new"
          className={({ isActive }) => (isActive ? 'nav-active' : 'nav-item')}
        >
          <Plus size={18} />
          Create team
        </NavLink>
        <span className="nav-label crew-nav-label">ACTIVE CREW</span>
        <Link
          className="active-crew"
          to={teamId ? `/teams/${teamId}/tasks` : '/dashboard'}
        >
          <Anchor size={18} />
          <strong>{team.data?.name ?? 'Choose your crew'}</strong>
        </Link>
        {teamId && (
          <nav className="crew-navigation" aria-label="Crew navigation">
            <NavLink to={`/teams/${teamId}/tasks`}>
              <Columns3 size={17} />
              Missions
            </NavLink>
            {team.data && team.data.role !== 'member' && (
              <NavLink to={`/teams/${teamId}/proposals`}>
                <FileCheck2 size={17} />
                Mission proposals
              </NavLink>
            )}
            <NavLink to={`/teams/${teamId}/members`}>
              <Users size={17} />
              Members & settings
            </NavLink>
          </nav>
        )}
        <div className="sidebar-voyage">
          <span className="eyebrow">ONE CREW. ONE SHARED COURSE.</span>
          <p>
            A clear course.
            <br />A connected crew.
          </p>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">{user?.name[0]?.toUpperCase()}</span>
          <div>
            <strong>{user?.name}</strong>
            <small>{user?.email}</small>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <span>
            <Link to="/dashboard">Workspace</Link>
            <span className="breadcrumb">/ {title}</span>
          </span>
          <div className="topbar-identity">
            <Link to="/account">Account</Link>
            {team.data && (
              <span className={`role-badge ${team.data.role}`}>
                {roleLabels[team.data.role]}
              </span>
            )}
            <span className="avatar" aria-label={user?.name}>
              {user?.name
                .split(' ')
                .map((part) => part[0])
                .slice(0, 2)
                .join('')}
            </span>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => void logout()}
            >
              <LogOut size={16} />
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>
        <main className="dashboard">
          <ErrorMessage error={error} />
          {children}
        </main>
      </div>
    </div>
  );
}
