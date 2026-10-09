import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  teamsApi,
  invitationsApi,
  type Team,
  type Member,
  type Invitation,
} from '../api/teams.api';
import { Dashboard } from './Dashboard';
import { CreateTeam } from './CreateTeam';
import { TeamPage } from './TeamPage';
import { InvitationPage } from './InvitationPage';
import { authApi } from '../api/client';
import { AuthPage } from '../features/auth/AuthPage';

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('../api/teams.api', () => ({
  teamsApi: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    members: vi.fn(),
    changeRole: vi.fn(),
    remove: vi.fn(),
    invite: vi.fn(),
    invitations: vi.fn(),
    revoke: vi.fn(),
  },
  invitationsApi: { incoming: vi.fn(), get: vi.fn(), respond: vi.fn() },
}));
const team: Team = {
  id: 'a'.repeat(24),
  name: 'Product team',
  description: 'Build together',
  ownerId: 'b'.repeat(24),
  role: 'owner',
  memberCount: 1,
  createdAt: new Date().toISOString(),
};
const owner: Member = {
  id: team.ownerId,
  name: 'Alex',
  email: 'alex@example.com',
  role: 'owner',
  joinedAt: new Date().toISOString(),
};
const invited: Invitation = {
  id: 'c'.repeat(24),
  teamId: team.id,
  teamName: team.name,
  email: 'sam@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  createdAt: new Date().toISOString(),
  inviteUrl: `http://localhost:5173/invitations/${'d'.repeat(64)}`,
};
const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  total: items.length,
  pages: 1,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.me).mockResolvedValue(owner);
  vi.mocked(teamsApi.list).mockResolvedValue(page([]));
  vi.mocked(teamsApi.get).mockResolvedValue(team);
  vi.mocked(teamsApi.members).mockResolvedValue(page([owner]));
  vi.mocked(teamsApi.invitations).mockResolvedValue(page([]));
  vi.mocked(invitationsApi.incoming).mockResolvedValue(page([]));
});
function show(path = '/dashboard') {
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60000 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/teams/new" element={<CreateTeam />} />
          <Route path="/teams/:teamId" element={<TeamPage />} />
          <Route path="/teams/:teamId/tasks" element={<TeamPage />} />
          <Route path="/invitations/:token" element={<InvitationPage />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage register />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
describe('Team and invitation screens', () => {
  it('creates a crew inline on the dashboard using a suggested name', async () => {
    vi.mocked(teamsApi.create).mockResolvedValue(team);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Straw Hat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create team' }));
    await screen.findByText('Alex (you)');
    expect(teamsApi.create).toHaveBeenCalledWith({
      name: 'Straw Hat',
      description: '',
    });
  });
  it('shows an accessible loading skeleton while crews are loading', async () => {
    vi.mocked(teamsApi.list).mockReturnValue(new Promise(() => {}));
    show();
    expect(await screen.findByText('Loading your teams…')).toBeInTheDocument();
    expect(document.querySelector('.loading-state')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(document.querySelector('.skeleton-grid')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
  it('selects a crew name without submitting and still accepts a custom name', async () => {
    show('/teams/new');
    expect(screen.getByText(/You’ll be the Celestial/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Straw Hat' }));
    expect(screen.getByLabelText('Team name')).toHaveValue('Straw Hat');
    expect(teamsApi.create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Whitebeard' }));
    expect(screen.getByLabelText('Team name')).toHaveValue('Whitebeard');
    await userEvent.clear(screen.getByLabelText('Team name'));
    await userEvent.type(screen.getByLabelText('Team name'), 'My own crew');
    expect(screen.getByRole('button', { name: 'Whitebeard' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
  it('lets the Celestial appoint Holy Knights using the existing role permissions', async () => {
    const sam: Member = {
      ...owner,
      id: 'e'.repeat(24),
      name: 'Sam',
      role: 'member',
    };
    let promoted = false;
    vi.mocked(teamsApi.members).mockImplementation(async () =>
      page([owner, { ...sam, role: promoted ? 'admin' : 'member' }]),
    );
    vi.mocked(teamsApi.changeRole).mockImplementation(async () => {
      promoted = true;
    });
    show(`/teams/${team.id}`);
    const role = await screen.findByRole('combobox', { name: 'Role for Sam' });
    expect(screen.getAllByText('Celestial').length).toBeGreaterThan(0);
    expect(role).toHaveDisplayValue('Commoners');
    await userEvent.selectOptions(role, 'admin');
    await waitFor(() =>
      expect(teamsApi.changeRole).toHaveBeenCalledWith(
        team.id,
        sam.id,
        'admin',
      ),
    );
    await waitFor(() => expect(role).toHaveDisplayValue('Holy Knights'));
  });
  it('creates a team from the empty dashboard and opens the saved team', async () => {
    vi.mocked(teamsApi.create).mockResolvedValue(team);
    show();
    await userEvent.click(
      await screen.findByRole('link', { name: 'Create your first team' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create team' }));
    expect(
      await screen.findByText('Enter at least 2 characters'),
    ).toBeInTheDocument();
    expect(teamsApi.create).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Team name'), team.name);
    await userEvent.type(
      screen.getByLabelText(/Description/),
      team.description,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create team' }));
    expect(
      await screen.findByRole('heading', { name: team.name }),
    ).toBeInTheDocument();
    expect(teamsApi.create).toHaveBeenCalledWith({
      name: team.name,
      description: team.description,
    });
    expect(await screen.findByText('Alex (you)')).toBeInTheDocument();
  });
  it('lists saved teams and opens their workspace', async () => {
    vi.mocked(teamsApi.list).mockResolvedValue(page([team]));
    show();
    await userEvent.click(
      await screen.findByRole('link', { name: /Product team/ }),
    );
    expect(
      await screen.findByRole('heading', { name: team.name }),
    ).toBeInTheDocument();
    expect(teamsApi.get).toHaveBeenCalledWith(team.id);
  });
  it('creates an invitation, displays its local link, and refreshes the invitation list', async () => {
    let created = false;
    vi.mocked(teamsApi.invite).mockImplementation(async () => {
      created = true;
      return invited;
    });
    vi.mocked(teamsApi.invitations).mockImplementation(async () =>
      page(created ? [invited] : []),
    );
    show(`/teams/${team.id}`);
    const input = await screen.findByLabelText('Email address');
    await userEvent.type(input, 'invalid');
    await userEvent.click(
      screen.getByRole('button', { name: 'Invite member' }),
    );
    expect(
      await screen.findByText('Enter a valid email address'),
    ).toBeInTheDocument();
    expect(teamsApi.invite).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, invited.email);
    await userEvent.click(
      screen.getByRole('button', { name: 'Invite member' }),
    );
    expect(await screen.findByDisplayValue(invited.inviteUrl!)).toHaveAttribute(
      'readonly',
    );
    expect(teamsApi.invite).toHaveBeenCalledWith(team.id, {
      email: invited.email,
      role: 'member',
    });
    expect(screen.getByText(/Valid for 48 hours/)).toBeInTheDocument();
    const whatsapp = new URL(
      screen
        .getByRole('link', { name: 'Share on WhatsApp' })
        .getAttribute('href')!,
    );
    expect(whatsapp.origin).toBe('https://wa.me');
    expect(whatsapp.searchParams.get('text')).toContain(invited.inviteUrl);
    expect(
      screen.getByRole('link', { name: 'Share by email' }),
    ).toHaveAttribute('href', expect.stringContaining('mailto:'));
    expect(
      await screen.findByRole('button', { name: 'Revoke' }),
    ).toBeInTheDocument();
  });
  it('hides management controls for regular members', async () => {
    vi.mocked(teamsApi.get).mockResolvedValue({ ...team, role: 'member' });
    show(`/teams/${team.id}`);
    await screen.findByRole('heading', { name: team.name });
    await screen.findByText('Alex (you)');
    expect(
      screen.queryByRole('button', { name: 'Invite member' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save settings' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove' }),
    ).not.toBeInTheDocument();
    expect(teamsApi.invitations).not.toHaveBeenCalled();
  });
  it('confirms member removal and refreshes the member list', async () => {
    const sam: Member = {
      ...owner,
      id: 'e'.repeat(24),
      name: 'Sam',
      email: invited.email,
      role: 'member',
    };
    let removed = false;
    vi.mocked(teamsApi.members).mockImplementation(async () =>
      page(removed ? [owner] : [owner, sam]),
    );
    vi.mocked(teamsApi.remove).mockImplementation(async () => {
      removed = true;
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    show(`/teams/${team.id}`);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Sam')).not.toBeInTheDocument(),
    );
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Remove Sam'));
    expect(teamsApi.remove).toHaveBeenCalledWith(team.id, sam.id);
    confirm.mockRestore();
  });
  it('accepts an inbox invitation and navigates to the team', async () => {
    vi.mocked(invitationsApi.incoming).mockResolvedValue(page([invited]));
    vi.mocked(invitationsApi.respond).mockResolvedValue({
      teamId: team.id,
      status: 'accepted',
    });
    show();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    );
    expect(
      await screen.findByRole('heading', { name: team.name, level: 1 }),
    ).toBeInTheDocument();
    expect(invitationsApi.respond).toHaveBeenCalledWith(invited.id, 'accept');
  });
  it('shows a useful team access error', async () => {
    vi.mocked(teamsApi.get).mockRejectedValue(
      new Error('You do not belong to this team'),
    );
    show(`/teams/${team.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not belong to this team',
    );
    expect(teamsApi.members).not.toHaveBeenCalled();
  });
  it('keeps the invitation destination while switching between login and registration', async () => {
    vi.mocked(authApi.me).mockResolvedValue(null as never);
    const token = 'd'.repeat(64);
    show(`/invitations/${token}`);
    await userEvent.click(await screen.findByRole('link', { name: 'Sign in' }));
    expect(
      screen.getByRole('link', { name: 'Create an account' }),
    ).toHaveAttribute(
      'href',
      `/register?next=${encodeURIComponent(`/invitations/${token}`)}`,
    );
    expect(invitationsApi.get).not.toHaveBeenCalled();
  });
  it('shows expired invitation state without offering acceptance', async () => {
    vi.mocked(invitationsApi.get).mockResolvedValue({
      ...invited,
      status: 'expired',
    });
    show(`/invitations/${'d'.repeat(64)}`);
    expect(
      await screen.findByText('This invitation is expired.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Accept invitation' }),
    ).not.toBeInTheDocument();
  });
});
