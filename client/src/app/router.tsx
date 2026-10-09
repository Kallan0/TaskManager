import { RecoveryPage } from '../pages/RecoveryPage';
import { AccountPage } from '../pages/AccountPage';
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { AuthPage } from '../features/auth/AuthPage';
import { Dashboard } from '../pages/Dashboard';
import { useSession } from '../hooks/useSession';
import { CreateTeam } from '../pages/CreateTeam';
import { TeamPage } from '../pages/TeamPage';
import { InvitationPage } from '../pages/InvitationPage';
import { TasksPage } from '../pages/TasksPage';
import { TaskEditor } from '../pages/TaskEditor';
import { TaskDetail } from '../pages/TaskDetail';
import { MissionProposalsPage } from '../pages/MissionProposalsPage';
function ProtectedRoute() {
  const session = useSession();
  if (session.isPending)
    return (
      <main className="session-state" role="status">
        Opening your workspace…
      </main>
    );
  if (session.isError)
    return (
      <main className="session-state">
        <h1>We couldn’t load your workspace</h1>
        <p>{session.error.message}</p>
        <button className="primary" onClick={() => void session.refetch()}>
          Try again
        </button>
      </main>
    );
  return session.data ? <Outlet /> : <Navigate to="/login" replace />;
}
export const router = createBrowserRouter([
  { path: '/recover', element: <RecoveryPage /> },
  { path: '/login', element: <AuthPage /> },
  { path: '/register', element: <AuthPage register /> },
  { path: '/invitations/:token', element: <InvitationPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/account', element: <AccountPage /> },
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/teams/new', element: <CreateTeam /> },
      { path: '/teams/:teamId', element: <TasksPage /> },
      { path: '/teams/:teamId/members', element: <TeamPage /> },
      { path: '/teams/:teamId/proposals', element: <MissionProposalsPage /> },
      { path: '/teams/:teamId/tasks', element: <TasksPage /> },
      { path: '/teams/:teamId/board', element: <TasksPage board /> },
      { path: '/teams/:teamId/tasks/new', element: <TaskEditor /> },
      { path: '/teams/:teamId/tasks/:taskId/edit', element: <TaskEditor /> },
      { path: '/teams/:teamId/tasks/:taskId', element: <TaskDetail /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
