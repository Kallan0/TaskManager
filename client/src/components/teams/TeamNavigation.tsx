import { NavLink, useLocation } from 'react-router-dom';
export function TeamNavigation({ teamId }: { teamId: string }) {
  const { pathname } = useLocation();
  return (
    <nav className="team-tabs" aria-label="Team views">
      <NavLink
        end
        to={`/teams/${teamId}/tasks`}
        className={({ isActive }) =>
          isActive || pathname === `/teams/${teamId}` ? 'active' : ''
        }
      >
        Mission list
      </NavLink>
      <NavLink to={`/teams/${teamId}/board`}>Kanban board</NavLink>
      <NavLink to={`/teams/${teamId}/members`}>Members & settings</NavLink>
    </nav>
  );
}
