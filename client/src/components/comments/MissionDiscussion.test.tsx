import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { commentsApi, type MissionComment } from '../../api/comments.api';
import { ApiError } from '../../api/client';
import { MissionDiscussion } from './MissionDiscussion';
vi.mock('../../api/comments.api', () => ({
  commentsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
const comment: MissionComment = {
  id: 'comment-1',
  teamId: 'team-1',
  taskId: 'mission-1',
  author: { id: 'author-1', name: 'Sam' },
  body: 'Ready to sail',
  createdAt: '2026-10-09T10:00:00Z',
  updatedAt: '2026-10-09T10:00:00Z',
  editedAt: null,
  version: 3,
  canEdit: true,
  canDelete: true,
};
const page = (items: MissionComment[]) => ({
  items,
  page: 1,
  total: items.length,
  pages: 1,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(commentsApi.list).mockResolvedValue(page([]));
});
function show() {
  return render(
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
      <MissionDiscussion teamId="team-1" taskId="mission-1" />
    </QueryClientProvider>,
  );
}
describe('Mission discussion', () => {
  it('opens the last page after posting and returns to a valid page after deleting its last comment', async () => {
    const user = userEvent.setup();
    let extra = false;
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      ...comment,
      id: `existing-${index}`,
      author: { id: `crew-${index}`, name: `Crew ${index}` },
      body: `Earlier update ${index}`,
      canEdit: false,
      canDelete: false,
    }));
    vi.mocked(commentsApi.list).mockImplementation(
      async (_team, _mission, current = 1) => ({
        items: current === 1 ? firstPage : extra ? [comment] : [],
        page: current,
        pages: extra ? 2 : 1,
        total: extra ? 21 : 20,
      }),
    );
    vi.mocked(commentsApi.create).mockImplementation(async () => {
      extra = true;
      return comment;
    });
    vi.mocked(commentsApi.remove).mockImplementation(async () => {
      extra = false;
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      show();
      await screen.findByText('Earlier update 0');
      await user.type(screen.getByLabelText('Add a comment'), comment.body);
      await user.click(screen.getByRole('button', { name: 'Post comment' }));
      expect(await screen.findByText(comment.body)).toBeInTheDocument();
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Delete comment by Sam' }),
      );
      await screen.findByText('Earlier update 0');
      expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Next' }),
      ).not.toBeInTheDocument();
    } finally {
      confirm.mockRestore();
    }
  });
  it('shows loading and empty states and validates whitespace before posting', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.getByRole('status')).toHaveTextContent('Loading discussion');
    await screen.findByText(/No comments yet/);
    await user.type(screen.getByLabelText('Add a comment'), '   ');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Write a comment before posting',
    );
    expect(commentsApi.create).not.toHaveBeenCalled();
  });
  it('posts trimmed text, clears the composer and shows the saved author', async () => {
    const user = userEvent.setup();
    let posted = false;
    vi.mocked(commentsApi.list).mockImplementation(async () =>
      page(posted ? [comment] : []),
    );
    vi.mocked(commentsApi.create).mockImplementation(async () => {
      posted = true;
      return comment;
    });
    show();
    await screen.findByText(/No comments yet/);
    await user.type(
      screen.getByLabelText('Add a comment'),
      '  Ready to sail  ',
    );
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByText('Ready to sail')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(commentsApi.create).toHaveBeenCalledWith(
      'team-1',
      'mission-1',
      'Ready to sail',
    );
    expect(screen.getByLabelText('Add a comment')).toHaveValue('');
  });
  it('renders markup as plain text and hides unauthorized controls', async () => {
    const body = '<img src=x onerror="alert(1)">';
    vi.mocked(commentsApi.list).mockResolvedValue(
      page([{ ...comment, body, canEdit: false, canDelete: false }]),
    );
    const { container } = show();
    expect(await screen.findByText(body)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Edit comment by Sam' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete comment by Sam' }),
    ).not.toBeInTheDocument();
  });
  it('edits with the captured version and displays the edited marker', async () => {
    const user = userEvent.setup();
    let saved = comment;
    vi.mocked(commentsApi.list).mockImplementation(async () => page([saved]));
    vi.mocked(commentsApi.update).mockImplementation(async () => {
      saved = {
        ...comment,
        body: 'New progress',
        version: 4,
        editedAt: '2026-10-09T11:00:00Z',
      };
      return saved;
    });
    show();
    await user.click(
      await screen.findByRole('button', { name: 'Edit comment by Sam' }),
    );
    const input = screen.getByLabelText('Edit comment by Sam');
    await user.clear(input);
    await user.type(input, 'New progress');
    await user.click(screen.getByRole('button', { name: 'Save comment' }));
    expect(await screen.findByText('New progress')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();
    expect(commentsApi.update).toHaveBeenCalledWith(
      'team-1',
      'mission-1',
      comment.id,
      'New progress',
      3,
    );
  });
  it('shows stale-edit errors and reloads the current version into the editor', async () => {
    const user = userEvent.setup();
    vi.mocked(commentsApi.list).mockResolvedValue(page([comment]));
    vi.mocked(commentsApi.update).mockRejectedValue(
      new ApiError(409, {
        code: 'COMMENT_CONFLICT',
        message: 'This comment changed. Reload it before trying again',
      }),
    );
    show();
    await user.click(
      await screen.findByRole('button', { name: 'Edit comment by Sam' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This comment changed',
    );
    vi.mocked(commentsApi.list).mockResolvedValue(
      page([{ ...comment, body: 'Newest progress', version: 4 }]),
    );
    await user.click(screen.getByRole('button', { name: 'Reload comment' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Edit comment by Sam')).toHaveValue(
        'Newest progress',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    vi.mocked(commentsApi.update).mockResolvedValue({
      ...comment,
      body: 'Newest progress',
      version: 4,
    });
    await user.click(screen.getByRole('button', { name: 'Save comment' }));
    await waitFor(() =>
      expect(commentsApi.update).toHaveBeenLastCalledWith(
        'team-1',
        'mission-1',
        comment.id,
        'Newest progress',
        4,
      ),
    );
  });
  it('allows moderation without editing and confirms deletion', async () => {
    const user = userEvent.setup();
    let removed = false;
    vi.mocked(commentsApi.list).mockImplementation(async () =>
      page(removed ? [] : [{ ...comment, canEdit: false }]),
    );
    vi.mocked(commentsApi.remove).mockImplementation(async () => {
      removed = true;
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      show();
      const button = await screen.findByRole('button', {
        name: 'Delete comment by Sam',
      });
      expect(
        screen.queryByRole('button', { name: 'Edit comment by Sam' }),
      ).not.toBeInTheDocument();
      await user.click(button);
      expect(commentsApi.remove).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      await user.click(button);
      await screen.findByText(/No comments yet/);
      expect(commentsApi.remove).toHaveBeenCalledWith(
        'team-1',
        'mission-1',
        comment.id,
        3,
      );
    } finally {
      confirm.mockRestore();
    }
  });
  it('requests the next page of discussion', async () => {
    const user = userEvent.setup();
    vi.mocked(commentsApi.list).mockImplementation(
      async (_team, _mission, current = 1) => ({
        ...page([
          { ...comment, body: current === 1 ? 'First page' : 'Second page' },
        ]),
        page: current,
        pages: 2,
        total: 21,
      }),
    );
    show();
    await screen.findByText('First page');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Second page')).toBeInTheDocument();
    expect(commentsApi.list).toHaveBeenCalledWith('team-1', 'mission-1', 2);
  });
  it('retains the draft when posting fails so the author can retry', async () => {
    const user = userEvent.setup();
    vi.mocked(commentsApi.create).mockRejectedValue(
      new Error('Unable to save comment'),
    );
    show();
    await screen.findByText(/No comments yet/);
    await user.type(screen.getByLabelText('Add a comment'), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to save comment',
    );
    expect(screen.getByLabelText('Add a comment')).toHaveValue(
      'Keep this draft',
    );
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeEnabled();
  });
});
