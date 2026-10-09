import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authApi, ApiError } from '../api/client';
import {
  teamsApi,
  invitationsApi,
  type Team,
  type Member,
} from '../api/teams.api';
import { tasksApi, type Task } from '../api/tasks.api';
import { TasksPage } from './TasksPage';
import { TaskEditor } from './TaskEditor';
import { TaskDetail } from './TaskDetail';
import { Dashboard } from './Dashboard';
import { MissionProposalsPage } from './MissionProposalsPage';
import { commentsApi } from '../api/comments.api';
vi.mock('../api/comments.api', () => ({
  commentsApi: { list: vi.fn(), create: vi.fn() },
}));
vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('../api/teams.api', () => ({
  teamsApi: { get: vi.fn(), list: vi.fn() },
  invitationsApi: { incoming: vi.fn() },
}));
vi.mock('../api/tasks.api', async (original) => ({
  ...(await original<typeof import('../api/tasks.api')>()),
  tasksApi: {
    list: vi.fn(),
    summary: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    status: vi.fn(),
    remove: vi.fn(),
    activity: vi.fn(),
    members: vi.fn(),
    propose: vi.fn(),
    review: vi.fn(),
  },
}));
const team: Team = {
  id: 'a'.repeat(24),
  name: 'Product team',
  description: '',
  role: 'owner',
  ownerId: 'b'.repeat(24),
  memberCount: 1,
  createdAt: '2026-10-09T00:00:00Z',
};
const owner: Member = {
  id: team.ownerId,
  name: 'Alex',
  email: 'alex@example.com',
  role: 'owner',
  joinedAt: team.createdAt,
};
const task: Task = {
  id: 'c'.repeat(24),
  teamId: team.id,
  title: 'Ship feature',
  description: 'Persisted details',
  status: 'todo',
  priority: 'high',
  assigneeId: owner.id,
  assignee: { id: owner.id, name: owner.name },
  creatorId: owner.id,
  creator: { id: owner.id, name: owner.name },
  startDate: null,
  dueDate: null,
  completedAt: null,
  createdAt: team.createdAt,
  updatedAt: team.createdAt,
  version: 3,
  canDelete: true,
  canEdit: true,
  canChangeStatus: true,
  canReview: false,
  approvalStatus: 'approved',
  reviewedAt: null,
  rejectionReason: '',
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
  vi.mocked(teamsApi.get).mockResolvedValue(team);
  vi.mocked(teamsApi.list).mockResolvedValue(page([team]));
  vi.mocked(invitationsApi.incoming).mockResolvedValue(page([]));
  vi.mocked(tasksApi.members).mockResolvedValue([owner]);
  vi.mocked(tasksApi.get).mockResolvedValue(task);
  vi.mocked(tasksApi.list).mockImplementation(async (_team, filters) =>
    page(filters?.approval ? [] : [task]),
  );
  vi.mocked(tasksApi.activity).mockResolvedValue(page([]));
  vi.mocked(commentsApi.list).mockResolvedValue(page([]));
  vi.mocked(tasksApi.summary).mockResolvedValue({
    todo: 1,
    in_progress: 0,
    in_review: 0,
    done: 0,
    total: 1,
  });
});
function show(path: string) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, staleTime: 60000 },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter
        initialEntries={[
          path.startsWith('/') ? path : `/teams/${team.id}/${path}`,
        ]}
      >
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route
            path="/teams/:teamId/proposals"
            element={<MissionProposalsPage />}
          />
          <Route path="/teams/:teamId/tasks" element={<TasksPage />} />
          <Route path="/teams/:teamId/board" element={<TasksPage board />} />
          <Route path="/teams/:teamId/tasks/new" element={<TaskEditor />} />
          <Route
            path="/teams/:teamId/tasks/:taskId/edit"
            element={<TaskEditor />}
          />
          <Route path="/teams/:teamId/tasks/:taskId" element={<TaskDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe('Task workflows', () => {
  it('keeps Commoners out of proposal data when opening the new review page directly', async () => {
    vi.mocked(teamsApi.get).mockResolvedValue({ ...team, role: 'member' });
    show('proposals');
    expect(
      await screen.findByRole('link', { name: 'View approved missions' }),
    ).toHaveAttribute('href', `/teams/${team.id}/tasks`);
    expect(tasksApi.list).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('link', { name: 'Mission proposals' }),
    ).not.toBeInTheDocument();
  });
  it('opens a saved mission from the dashboard and lets a Commoner post a comment', async () => {
    const user = userEvent.setup();
    const readonly = {
      ...task,
      canEdit: false,
      canChangeStatus: false,
      canDelete: false,
    };
    vi.mocked(teamsApi.get).mockResolvedValue({ ...team, role: 'member' });
    vi.mocked(teamsApi.list).mockResolvedValue(
      page([{ ...team, role: 'member' }]),
    );
    vi.mocked(tasksApi.list).mockResolvedValue(page([readonly]));
    vi.mocked(tasksApi.get).mockResolvedValue(readonly);
    const comment = {
      id: 'd'.repeat(24),
      teamId: team.id,
      taskId: task.id,
      author: { id: owner.id, name: owner.name },
      body: 'Ready to help with this mission',
      editedAt: null,
      createdAt: team.createdAt,
      updatedAt: team.createdAt,
      version: 0,
      canEdit: true,
      canDelete: true,
    };
    let posted = false;
    vi.mocked(commentsApi.list).mockImplementation(async () =>
      page(posted ? [comment] : []),
    );
    vi.mocked(commentsApi.create).mockImplementation(async () => {
      posted = true;
      return comment;
    });
    show('/dashboard');
    await user.click(
      await screen.findByRole('link', { name: /View missions & comments/ }),
    );
    await user.click(
      await screen.findByRole('link', {
        name: `Open mission & comments for ${task.title}`,
      }),
    );
    await user.type(
      await screen.findByLabelText('Add a comment'),
      comment.body,
    );
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByText(comment.body)).toBeInTheDocument();
    expect(commentsApi.create).toHaveBeenCalledWith(
      team.id,
      task.id,
      comment.body,
    );
    expect(
      screen.queryByRole('link', { name: 'Edit mission' }),
    ).not.toBeInTheDocument();
  });
  it('gives Commoners a read-only mission list while hiding creation and proposal controls', async () => {
    vi.mocked(teamsApi.get).mockResolvedValue({ ...team, role: 'member' });
    vi.mocked(tasksApi.list).mockResolvedValue(
      page([
        { ...task, canEdit: false, canChangeStatus: false, canDelete: false },
      ]),
    );
    show('tasks');
    await screen.findByRole('link', { name: task.title });
    expect(
      screen.queryByRole('link', { name: 'Create mission' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Propose mission' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: `Status for ${task.title}` }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Mission proposals' }),
    ).not.toBeInTheDocument();
  });
  it('blocks a Commoner opening the create route directly', async () => {
    vi.mocked(teamsApi.get).mockResolvedValue({ ...team, role: 'member' });
    show('tasks/new');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the Celestial',
    );
    expect(screen.queryByLabelText('Mission title')).not.toBeInTheDocument();
  });
  it('lets Holy Knights submit proposals with To do status and shows them awaiting approval', async () => {
    const user = userEvent.setup();
    vi.mocked(teamsApi.get).mockResolvedValue({ ...team, role: 'admin' });
    const pending: Task = {
      ...task,
      approvalStatus: 'pending',
      canReview: false,
      canEdit: false,
      canDelete: false,
      canChangeStatus: false,
    };
    vi.mocked(tasksApi.propose).mockResolvedValue(pending);
    vi.mocked(tasksApi.get).mockResolvedValue(pending);
    show('tasks/new?status=done');
    await user.type(await screen.findByLabelText('Mission title'), task.title);
    expect(screen.getByLabelText('Status')).toHaveValue('todo');
    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));
    await screen.findByText(/Awaiting the Celestial/);
    expect(tasksApi.propose).toHaveBeenCalledWith(
      team.id,
      expect.objectContaining({ title: task.title, status: 'todo' }),
    );
    expect(tasksApi.create).not.toHaveBeenCalled();
    expect(commentsApi.list).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Approve mission' }),
    ).not.toBeInTheDocument();
  });
  it('lets the Celestial approve a proposal and opens discussion after approval', async () => {
    const user = userEvent.setup();
    let saved: Task = {
      ...task,
      approvalStatus: 'pending',
      canReview: true,
      canEdit: false,
      canDelete: false,
      canChangeStatus: false,
    };
    vi.mocked(tasksApi.get).mockImplementation(async () => saved);
    vi.mocked(tasksApi.review).mockImplementation(async () => {
      saved = { ...task, version: 4, reviewedAt: new Date().toISOString() };
      return saved;
    });
    show(`tasks/${task.id}`);
    await user.click(
      await screen.findByRole('button', { name: 'Approve mission' }),
    );
    await screen.findByRole('heading', { name: 'Mission discussion' });
    expect(tasksApi.review).toHaveBeenCalledWith(
      team.id,
      task.id,
      'approved',
      3,
      '',
    );
    expect(
      screen.getByRole('link', { name: 'Edit mission' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve mission' }),
    ).not.toBeInTheDocument();
  });
  it('lets the Celestial reject with a reason and keeps discussion hidden', async () => {
    const user = userEvent.setup();
    let saved: Task = {
      ...task,
      approvalStatus: 'pending',
      canReview: true,
      canEdit: false,
      canDelete: false,
      canChangeStatus: false,
    };
    vi.mocked(tasksApi.get).mockImplementation(async () => saved);
    vi.mocked(tasksApi.review).mockImplementation(async () => {
      saved = {
        ...saved,
        approvalStatus: 'rejected',
        canReview: false,
        rejectionReason: 'Clarify the goal',
        version: 4,
      };
      return saved;
    });
    show(`tasks/${task.id}`);
    await user.type(
      await screen.findByLabelText('Reason if rejecting (optional)'),
      'Clarify the goal',
    );
    await user.click(screen.getByRole('button', { name: 'Reject proposal' }));
    await screen.findByText('Proposal rejected: Clarify the goal');
    expect(tasksApi.review).toHaveBeenCalledWith(
      team.id,
      task.id,
      'rejected',
      3,
      'Clarify the goal',
    );
    expect(commentsApi.list).not.toHaveBeenCalled();
  });
  it('disables dragging and status changes on the Commoner board', async () => {
    vi.mocked(teamsApi.get).mockResolvedValue({ ...team, role: 'member' });
    vi.mocked(tasksApi.list).mockImplementation(async (_team, filters) =>
      page(
        filters?.status === 'todo'
          ? [
              {
                ...task,
                canChangeStatus: false,
                canEdit: false,
                canDelete: false,
              },
            ]
          : [],
      ),
    );
    show('board');
    const card = (
      await screen.findByRole('link', { name: task.title })
    ).closest('article');
    expect(card).toHaveAttribute('draggable', 'false');
    expect(
      screen.queryByRole('combobox', { name: `Status for ${task.title}` }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: '+ Add mission' }),
    ).not.toBeInTheDocument();
  });
  it('shows a conflict and reloads the latest task before editing again', async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.update).mockRejectedValue(
      new ApiError(409, {
        code: 'TASK_CONFLICT',
        message: 'This mission changed. Reload it before saving',
      }),
    );
    show(`tasks/${task.id}/edit`);
    await screen.findByLabelText('Mission title');
    await user.click(screen.getByRole('button', { name: 'Save mission' }));
    expect(
      await screen.findByText('This mission changed. Reload it before saving'),
    ).toBeInTheDocument();
    vi.mocked(tasksApi.get).mockResolvedValue({
      ...task,
      title: 'Newest title',
      version: 4,
    });
    await user.click(
      screen.getByRole('button', { name: 'Reload latest mission' }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Mission title')).toHaveValue(
        'Newest title',
      ),
    );
  });
  it('validates an empty title and date ordering before saving', async () => {
    const user = userEvent.setup();
    show('tasks/new');
    await screen.findByLabelText('Mission title');
    await user.click(screen.getByRole('button', { name: 'Create mission' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(tasksApi.create).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Mission title'), 'New task');
    await user.type(screen.getByLabelText('Start date'), '2026-10-12');
    await user.type(screen.getByLabelText('Due date'), '2026-10-11');
    await user.click(screen.getByRole('button', { name: 'Create mission' }));
    expect(
      await screen.findByText('Due date must be on or after the start date'),
    ).toBeInTheDocument();
    expect(tasksApi.create).not.toHaveBeenCalled();
  });
  it('saves a task and opens persisted details', async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.create).mockResolvedValue(task);
    show('tasks/new');
    await user.type(await screen.findByLabelText('Mission title'), task.title);
    await user.selectOptions(screen.getByLabelText('Assignee'), owner.id);
    await user.click(screen.getByRole('button', { name: 'Create mission' }));
    await screen.findByRole('heading', { name: task.title });
    expect(tasksApi.create).toHaveBeenCalledWith(
      team.id,
      expect.objectContaining({
        title: task.title,
        assigneeId: owner.id,
        startDate: null,
        dueDate: null,
      }),
    );
  });
  it('sends the current version with an edit', async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.update).mockResolvedValue({ ...task, title: 'Revised' });
    show(`tasks/${task.id}/edit`);
    const title = await screen.findByLabelText('Mission title');
    await user.clear(title);
    await user.type(title, 'Revised');
    await user.click(screen.getByRole('button', { name: 'Save mission' }));
    await waitFor(() =>
      expect(tasksApi.update).toHaveBeenCalledWith(
        team.id,
        task.id,
        expect.objectContaining({ title: 'Revised', version: 3 }),
      ),
    );
  });
  it('passes filters to the server and saves list status changes', async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.status).mockResolvedValue({
      ...task,
      status: 'done',
      version: 4,
    });
    show('tasks');
    await screen.findByRole('link', { name: task.title });
    await user.selectOptions(screen.getByLabelText('Priority'), 'high');
    await waitFor(() =>
      expect(tasksApi.list).toHaveBeenCalledWith(
        team.id,
        expect.objectContaining({ priority: 'high' }),
        1,
      ),
    );
    await user.selectOptions(
      screen.getByLabelText(`Status for ${task.title}`),
      'done',
    );
    await waitFor(() =>
      expect(tasksApi.status).toHaveBeenCalledWith(team.id, task.id, 'done', 3),
    );
  });
  it('loads each board column independently and supports keyboard status changes', async () => {
    vi.mocked(tasksApi.list).mockImplementation(async (_team, filters) =>
      page(filters?.status === 'todo' ? [task] : []),
    );
    const user = userEvent.setup();
    vi.mocked(tasksApi.status).mockResolvedValue({
      ...task,
      status: 'in_review',
      version: 4,
    });
    show('board');
    await screen.findByRole('link', { name: task.title });
    expect(tasksApi.list).toHaveBeenCalledWith(
      team.id,
      expect.objectContaining({ status: 'done' }),
      1,
    );
    await user.selectOptions(
      screen.getByLabelText(`Status for ${task.title}`),
      'in_review',
    );
    await waitFor(() =>
      expect(tasksApi.status).toHaveBeenCalledWith(
        team.id,
        task.id,
        'in_review',
        3,
      ),
    );
  });
  it('hides deletion when unauthorized and confirms authorized deletion', async () => {
    vi.mocked(tasksApi.get).mockResolvedValue({ ...task, canDelete: false });
    show(`tasks/${task.id}`);
    await screen.findByRole('heading', { name: task.title });
    expect(
      screen.queryByRole('button', { name: 'Delete mission' }),
    ).not.toBeInTheDocument();
  });
  it('keeps a task when deletion is cancelled, then deletes with its version', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(tasksApi.remove).mockResolvedValue(undefined);
    show(`tasks/${task.id}`);
    await user.click(
      await screen.findByRole('button', { name: 'Delete mission' }),
    );
    expect(tasksApi.remove).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete mission' }));
    await waitFor(() =>
      expect(tasksApi.remove).toHaveBeenCalledWith(team.id, task.id, 3),
    );
    confirm.mockRestore();
  });
});
