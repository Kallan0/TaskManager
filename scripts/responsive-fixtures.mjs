// Isolated browser-test data: this server has no database connection.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const teamId = 'a'.repeat(24);
export const missionId = '1'.repeat(24);
export const proposalId = 'e'.repeat(24);
export const inviteToken = 'c'.repeat(64);
const user = {
  id: 'b'.repeat(24),
  name: 'Ava Morgan',
  email: 'ava@example.test',
};
const createdAt = '2026-10-10T00:00:00Z';
const page = (items) => ({ items, total: items.length, page: 1, pages: 1 });
const baseTeam = {
  id: teamId,
  name: 'Straw Hat',
  description: 'A clear course. A connected crew.',
  ownerId: user.id,
  memberCount: 5,
  createdAt,
};
const members = [
  user,
  { id: 'd'.repeat(24), name: 'Mira Chen', email: 'mira@example.test' },
].map((member, index) => ({
  ...member,
  role: index ? 'member' : 'owner',
  joinedAt: createdAt,
}));
const missions = [
  'Prepare departure checklist',
  'Chart the northern passage',
  'Review weather windows',
  'Assemble the expedition brief',
].map((title, index) => ({
  id: String(index + 1).repeat(24),
  teamId,
  title,
  description:
    'Plan the passage and keep your crew moving in the right direction.',
  status: ['todo', 'in_progress', 'in_review', 'done'][index],
  priority: ['medium', 'high', 'urgent', 'low'][index],
  assigneeId: members[index % 2].id,
  assignee: members[index % 2],
  creatorId: user.id,
  creator: user,
  startDate: null,
  dueDate: '2026-10-16',
  completedAt: null,
  createdAt,
  updatedAt: createdAt,
  version: 1,
  canDelete: true,
  canEdit: true,
  canChangeStatus: true,
  canReview: false,
  approvalStatus: 'approved',
  reviewedAt: null,
  rejectionReason: '',
}));

export async function startPreview() {
  const root = path.resolve('client/dist');
  const deployment = JSON.parse(await readFile('client/vercel.json', 'utf8'));
  const securityHeaders = deployment.routes[0].headers;
  const server = http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(securityHeaders))
      res.setHeader(name, value);
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (route.startsWith('/api/v1')) {
        const referrer = new URL(
          req.headers.referer || '/',
          'http://localhost',
        );
        const role = ['owner', 'admin', 'member'].includes(
          referrer.searchParams.get('role'),
        )
          ? referrer.searchParams.get('role')
          : 'owner';
        const state = referrer.searchParams.get('state');
        const team = { ...baseTeam, role };
        const proposal = {
          ...missions[0],
          id: proposalId,
          title: 'Explore an alternate route',
          approvalStatus: 'pending',
          canReview: role === 'owner',
          canEdit: false,
          canDelete: false,
          canChangeStatus: false,
        };
        const visible = missions.map((mission) => ({
          ...mission,
          canEdit: role === 'owner',
          canDelete: role === 'owner',
          canChangeStatus: role === 'owner',
        }));
        const invitation = {
          id: '7'.repeat(24),
          teamId,
          teamName: 'Horizon Survey',
          email: user.email,
          role: 'member',
          status:
            referrer.searchParams.get('invite') === 'requested'
              ? 'requested'
              : 'pending',
          applicant:
            referrer.searchParams.get('invite') === 'requested'
              ? members[1]
              : null,
          expiresAt: '2026-10-12T00:00:00Z',
          createdAt,
        };
        const json = (status, body) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (
          route.endsWith('/auth/me') &&
          ['/login', '/register'].includes(referrer.pathname)
        ) {
          json(401, {
            success: false,
            error: { code: 'UNAUTHENTICATED', message: 'Sign in' },
          });
          return;
        }
        if (!route.endsWith('/auth/me') && state === 'error') {
          json(503, {
            success: false,
            error: {
              code: 'UNAVAILABLE',
              message: 'Preview: service temporarily unavailable',
            },
          });
          return;
        }
        if (!route.endsWith('/auth/me') && state === 'loading')
          await new Promise((resolve) => setTimeout(resolve, 8000));
        let data;
        if (route.endsWith('/auth/me')) data = user;
        else if (route === '/api/v1/teams')
          data = page(
            state === 'empty'
              ? []
              : [
                  team,
                  {
                    ...team,
                    id: 'f'.repeat(24),
                    name: 'Whitebeard',
                    role: 'admin',
                  },
                  {
                    ...team,
                    id: '9'.repeat(24),
                    name: 'Rogers',
                    role: 'member',
                  },
                ],
          );
        else if (route === '/api/v1/invitations')
          data = page(state === 'empty' ? [] : [invitation]);
        else if (route.startsWith('/api/v1/invitations/')) data = invitation;
        else if (route.endsWith('/tasks/summary'))
          data = { todo: 1, in_progress: 1, in_review: 1, done: 1, total: 4 };
        else if (route.endsWith('/activity'))
          data = page(
            state === 'empty'
              ? []
              : [
                  {
                    id: '8'.repeat(24),
                    taskId: missionId,
                    taskTitle: missions[0].title,
                    taskDeleted: false,
                    actor: user,
                    type: 'TASK_CREATED',
                    changes: [],
                    createdAt,
                  },
                ],
          );
        else if (route.endsWith('/comments'))
          data = page(
            state === 'empty'
              ? []
              : [
                  {
                    id: '6'.repeat(24),
                    teamId,
                    taskId: missionId,
                    author: members[1],
                    body: 'Ready to chart the next chapter. The crew is prepared.',
                    editedAt: null,
                    createdAt,
                    updatedAt: createdAt,
                    version: 1,
                    canEdit: false,
                    canDelete: role !== 'member',
                  },
                ],
          );
        else if (route.endsWith('/tasks'))
          data = page(
            state === 'empty'
              ? []
              : url.searchParams.get('approval') === 'pending'
                ? [proposal]
                : url.searchParams.get('approval') === 'rejected'
                  ? []
                  : visible.filter(
                      (mission) =>
                        !url.searchParams.get('status') ||
                        mission.status === url.searchParams.get('status'),
                    ),
          );
        else if (route.includes('/tasks/'))
          data =
            visible.find((mission) => route.endsWith('/' + mission.id)) ||
            proposal;
        else if (route.endsWith('/members')) data = page(members);
        else if (route.endsWith('/invitations')) data = page([]);
        else data = team;
        json(200, { success: true, data });
        return;
      }
      const file = path.resolve(
        root,
        decodeURIComponent(url.pathname).slice(1) || 'index.html',
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const target = await stat(file)
        .then((info) => (info.isFile() ? file : path.join(root, 'index.html')))
        .catch(() => path.join(root, 'index.html'));
      const content = await readFile(target);
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.jpg': 'image/jpeg',
          }[path.extname(target)] || 'application/octet-stream',
      });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
