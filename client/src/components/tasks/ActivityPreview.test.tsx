import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tasksApi, type Activity } from '../../api/tasks.api';
import { ActivityPreview } from './ActivityPreview';
vi.mock('../../api/tasks.api', async (original) => ({
  ...(await original<typeof import('../../api/tasks.api')>()),
  tasksApi: { activity: vi.fn() },
}));
const first: Activity = {
  id: 'latest',
  taskId: 'mission-1',
  taskTitle: 'Set sail',
  taskDeleted: false,
  actor: { id: 'user-1', name: 'Alex' },
  type: 'STATUS_CHANGED',
  changes: [{ field: 'status', from: 'todo', to: 'done' }],
  createdAt: '2026-10-09T12:00:00Z',
};
const older: Activity = {
  ...first,
  id: 'older',
  actor: { id: 'user-2', name: 'Sam' },
  type: 'TASK_CREATED',
  changes: [],
};
const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal',
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close',
);
beforeAll(() => {
  // jsdom has no native dialog behavior; the browser provides focus trapping and modality.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
      this.querySelector<HTMLButtonElement>('button')?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
afterAll(() => {
  for (const [name, descriptor] of [
    ['showModal', showModalDescriptor],
    ['close', closeDescriptor],
  ] as const) {
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(tasksApi.activity).mockImplementation(
    async (_team, _mission, page = 1, limit = 20) => ({
      items:
        limit === 1
          ? [first]
          : page === 1
            ? [first, older]
            : [
                {
                  ...older,
                  id: 'oldest',
                  actor: { id: 'user-3', name: 'Robin' },
                },
              ],
      page,
      total: 21,
      pages: limit === 1 ? 21 : 2,
    }),
  );
});
function show(taskId?: string) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: 60000 } },
        })
      }
    >
      <MemoryRouter>
        <ActivityPreview teamId="team-1" taskId={taskId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe('Activity preview and history popup', () => {
  it('shows only the newest event and fetches full history only on request', async () => {
    const user = userEvent.setup();
    show('mission-1');
    await screen.findByText('Alex');
    expect(screen.queryByText('Sam')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(tasksApi.activity).toHaveBeenCalledTimes(1);
    expect(tasksApi.activity).toHaveBeenCalledWith('team-1', 'mission-1', 1, 1);
    await user.click(screen.getByRole('button', { name: 'View history' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Mission activity history',
    });
    expect(await within(dialog).findByText('Sam')).toBeInTheDocument();
    expect(tasksApi.activity).toHaveBeenCalledWith(
      'team-1',
      'mission-1',
      1,
      20,
    );
    expect(document.body.style.overflow).toBe('hidden');
  });
  it('paginates inside the popup without changing the latest event', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Alex');
    await user.click(screen.getByRole('button', { name: 'View history' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Team activity history',
    });
    await user.click(
      await within(dialog).findByRole('button', { name: 'Next' }),
    );
    expect(await within(dialog).findByText('Robin')).toBeInTheDocument();
    expect(tasksApi.activity).toHaveBeenCalledWith('team-1', undefined, 2, 20);
    expect(
      within(
        screen.getByRole('region', { name: 'Recent team activity' }),
      ).getByText('Alex'),
    ).toBeInTheDocument();
  });
  it('closes using the button and restores focus and page scrolling', async () => {
    const user = userEvent.setup();
    show();
    const trigger = screen.getByRole('button', { name: 'View history' });
    await user.click(trigger);
    await user.click(
      screen.getByRole('button', { name: 'Close activity history' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });
  it('responds to native Escape cancellation and closes on backdrop clicks', async () => {
    const user = userEvent.setup();
    show();
    const trigger = screen.getByRole('button', { name: 'View history' });
    await user.click(trigger);
    fireEvent(screen.getByRole('dialog'), new Event('close'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { bubbles: false, cancelable: true }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog, { clientX: -1, clientY: -1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps deleted mission names as text', async () => {
    vi.mocked(tasksApi.activity).mockResolvedValueOnce({
      items: [{ ...first, taskDeleted: true }],
      page: 1,
      total: 1,
      pages: 1,
    });
    show();
    await screen.findByText('Set sail');
    expect(
      screen.queryByRole('link', { name: 'Set sail' }),
    ).not.toBeInTheDocument();
  });
});
