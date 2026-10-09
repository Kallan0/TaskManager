# Team Mission Planner

The team creator is the **Celestial** (main admin), co-admins are **Holy Knights**, and ordinary members are **Commoners**. Only the Celestial appoints or demotes Holy Knights. Team creation offers optional **Straw Hat**, **Whitebeard**, and **Rogers** crew-name suggestions; custom names are welcome. Work items are called **missions** throughout the interface. Existing `owner` / `admin` / `member` permission values and `/tasks` API paths continue to support saved data.

MERN implementation from the supplied implementation plan. Project setup, authentication, teams, invitations, member management, missions, and mission discussions are implemented (phases 1–5). Phase 6 adds API hardening and automated validation.

## Local setup

Requirements: Node.js 22.12+ (Node 24 is supported) and npm.

```powershell
npm.cmd install
npm.cmd run db:setup
npm.cmd run dev
```

`db:setup` configures ignored local environment files, generates a private session secret if needed, and connects the application to `mongodb://127.0.0.1:27017/team_task_planner`. If MongoDB is already running there, it reuses that installation and its existing persistent storage. Otherwise, it starts the cached MongoDB 7.0.24 binary (downloading it on first use), bound only to localhost, with persistent files in `.local/mongodb/data` and logs in `.local/mongodb/mongod.log`. These development files are ignored by Git. This is local development configuration without authentication; production continues to require a separately configured database.

MongoDB runs in the background and preserves data when the app or database stops. After restarting your computer, use `dev:local` to start the database and both apps. Database management commands:

```powershell
npm.cmd run dev:local
npm.cmd run db:status
npm.cmd run db:stop
npm.cmd run db:start
```

Open http://localhost:5173. The API runs on http://localhost:5000. Vite forwards `/api` to the API, keeping development requests same-origin. The backend fails startup clearly when MongoDB cannot be reached. Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`.

`db:start` and `db:status` support an existing MongoDB installation on port 27017. `db:stop` only stops an instance whose data directory belongs to this project; manage an existing installation through its own service controls. To use Atlas or another server, set `MONGODB_URI` in `server/.env` and use `npm.cmd run dev`; `db:setup` intentionally switches the URI back to the local database.

## Implemented

The frontend follows the supplied `Untitled.zip` screen designs: a navy nautical workspace, crew navigation, a command-center dashboard with inline team creation, mission list/board totals, a dedicated proposal review page, and separated mission information, discussion, and recent activity panels. Teal, blue, violet, amber and coral accents distinguish crews, statuses, priorities and roles. The sign-in page follows the later standalone SVG, with a centered card and a moving background of mission words. Reference images and visual-review fixtures live only in ignored `.local` files; demonstration data is not included in the application or written to MongoDB.

Shared loading skeletons announce pending data to assistive technology; mission, team, proposal, invitation and discussion views preserve useful empty/error states. CSS entry, hover, dialog and loading animations require no animation dependency and respect `prefers-reduced-motion`. Mobile navigation and planning views adapt to narrow screens; the board can scroll horizontally inside its own container. Role restrictions, five-second password visibility, 48-hour invitation links and the latest-activity/history popup remain in place.

- React, Vite, TypeScript, React Router, TanStack Query, React Hook Form, and Zod.
- Express, Mongoose, configuration validation, security headers, body size limits, and structured API errors.
- Registration, normalized unique emails, bcrypt password hashing, login, current user, and logout.
- JWT cookies: HttpOnly, SameSite=Lax, 8-hour lifetime; Secure in production. Tokens never enter browser storage.
- Server-side token version checking: logout invalidates **all sessions for that account**, including copied cookies.
- Trusted Origin enforcement on every mutation, including login and registration, plus explicit credentialed CORS. In development, `localhost` and `127.0.0.1` are both trusted on the configured frontend protocol and port. Production trusts only `CLIENT_URL`. CLI clients must send `Origin: <CLIENT_URL>`.
- Authentication rate limiting, protected routes, field validation, pending/error states, and responsive UI.
- A database-backed dashboard listing your teams and pending invitations, with team creation and team/member pages.
- Team owner/admin/member roles, settings updates, member role changes, and confirmed removals. Only owners can assign admin roles; admins can remove regular members; owners cannot be removed or demoted.
- Unique invitation links valid for 48 hours, with hashed tokens, email identity checks, unique memberships, duplicate prevention, expiry, decline, revocation, and an invitation inbox.
- Shareable links shown to the creating manager, with Copy link, WhatsApp and email-app shortcuts. No SMTP or automatic email sending.
- Saved task creation, editing, assignment, deletion, status, priority, start/due dates, and completion timestamps.
- Paginated task list and Kanban columns, drag-and-drop and keyboard-accessible status changes, search, filters, sorting, and task totals.
- Task and team activity, stale-edit conflict detection, and automatic unassignment when a member is removed.
- Paginated mission discussions with plain-text comments, author/timestamps, an edited marker, author editing/deletion, and Celestial/Holy Knights moderation.

## API

Responses use `{ success: true, data: ... }` or `{ success: false, error: { code, message, details? } }`.

| Method | Path                    | Input / behavior                                              |
| ------ | ----------------------- | ------------------------------------------------------------- |
| GET    | `/health`               | 200 when MongoDB is connected; otherwise 503                  |
| POST   | `/api/v1/auth/register` | `{ name, email, password }`; sets cookie, returns public user |
| POST   | `/api/v1/auth/login`    | `{ email, password }`; sets cookie, returns public user       |
| GET    | `/api/v1/auth/me`       | Requires cookie; returns `{ id, name, email }`                |
| POST   | `/api/v1/auth/logout`   | Requires cookie; invalidates sessions and clears cookie; 204  |

Passwords require 10 characters at registration and must not exceed 72 UTF-8 bytes. No password hashes or session tokens appear in JSON responses.

Team API: `GET/POST /api/v1/teams`, `GET/PATCH /api/v1/teams/:teamId`, `GET /api/v1/teams/:teamId/members`, and `PATCH/DELETE /api/v1/teams/:teamId/members/:userId`. Managers can `GET/POST /api/v1/teams/:teamId/invitations` and revoke using `DELETE /api/v1/teams/:teamId/invitations/:invitationId`. List endpoints accept `page` and `limit` (maximum 100).

Recipient API: `GET /api/v1/invitations` lists your pending invitations. `GET /api/v1/invitations/:token` checks a link; `POST /api/v1/invitations/:token/accept` or `/decline` handles it. Inbox actions use `POST /api/v1/invitations/by-id/:invitationId/accept` or `/decline`; these verify the authenticated email independently of knowing the ID.

## Try team collaboration locally

1. Sign in and choose **Create team**. Give it a name and open its workspace.
2. Invite another email as Commoners or Holy Knights. Copy the generated link or use the WhatsApp/email-app shortcuts. The link expires 48 hours after creation.
3. Open an incognito window and register/sign in with that exact email. Accept from the link or the dashboard invitation inbox.
4. Both accounts can see the team and member list. The owner can change roles; managers can update settings, revoke invitations, and remove permitted members.

SMTP is not required. The server creates a random 256-bit token for each invitation, stores only its SHA-256 hash and expiry in MongoDB, and returns `<CLIENT_URL>/invitations/<token>` to the authorized manager immediately after creation, including in production. Copy and save the link at creation time: it cannot be reconstructed later from the stored hash. Share it through any medium; the email shortcut opens your email app and the WhatsApp shortcut opens a sharing page. Neither sends a message automatically. The recipient must sign in with the invited email. Expired, revoked or previously used links cannot grant new membership; revoke a pending invitation and create a fresh one if needed.

Each newly created invitation expires 48 hours after creation, enforced on the server when accepted. Existing invitations retain their stored expiry. Set `CLIENT_URL` to your publicly reachable frontend origin for other devices to open links; `localhost` links only work on the machine serving the app. SMTP settings are no longer used, and the MongoDB URI in your existing `.env` is preserved.

Local MongoDB runs standalone, so multi-document writes use unique indexes, atomic invitation claims, and compensating writes instead of transactions. Accepted links cannot re-add a removed member. If the process crashes between claiming an invitation and adding its membership, the owner must issue a fresh invitation; transaction-based recovery with a replica set is a later hardening item.

## Validation

Run `npm.cmd run test:responsive` to build the frontend and check all routes at 320, 390, 768 and 1440 pixels using a locally installed Edge/Chrome/Chromium browser. Set `RESPONSIVE_BROWSER_PATH` if the browser is installed elsewhere. These browser checks use an isolated fixture server with no database connection. They cover page/control overflow, crew role variants, empty/loading/error states, the activity dialog, CSS background motion with stationary text, and reduced-motion preferences. Screenshots and the JSON report are written to ignored `.local/responsive`. They test Chromium viewport behavior; real iOS Safari and Android device checks remain useful before release.

The current sign-in page follows the separately supplied `Sign in.svg`: a centered white card on a warm background of colorful mission and crew terms. Background rows drift gently with CSS transforms; headings and form controls stay still. Decorative words are hidden from assistive technology and do not intercept input. Motion stops for `prefers-reduced-motion`.

The GitHub Actions workflow in `.github/workflows/validate.yml` runs clean dependency installation, TypeScript checks, lint, formatting, all tests and both production builds on pushes and pull requests using Node 24. It is configured locally; no repository has been published or remote workflow run triggered. Frontend test files run sequentially to reduce timing failures on development machines.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run format:check
```

API tests start an isolated MongoDB using `mongodb-memory-server`; the first run downloads a MongoDB binary into `.cache/mongodb` and requires network access. Tests never use your configured development database. Tests cover authentication, team isolation, roles, invitation hashing/identity/expiry/revocation/concurrent acceptance, and frontend creation/invitation/member flows.

## Production configuration

Deployment preparation and scaling review:

- [Deployment plan](docs/deployment-plan.md): hosting topology, configuration, release prerequisites, staging/load-test gates, monitoring and rollback.
- [Multi-user reliability review](docs/multi-user-review.md): code-backed failure scenarios, priorities and recommended fixes. Public release readiness and supported user capacity have not yet been established.

`TRUST_PROXY_HOPS` defaults to `0`, so incoming forwarded IP headers are ignored. Set it only to the known fixed number of trusted reverse proxies in front of the API (1–5). Every route to the API must use that same proxy chain, and the outer proxy must replace client-provided forwarding headers. Do not enable it when clients can reach the API directly or through a shorter chain. Verify this against the actual host before deployment.

Build both workspaces with `npm run build`; start the API with `npm run start -w server`. Serve `client/dist` with SPA fallback to `index.html`, and proxy `/api` to the API. Configure `NODE_ENV=production`, an HTTPS `CLIENT_URL` (origin only, no trailing slash), a private `SESSION_SECRET`, and your MongoDB URI. Use frontend and API under the same origin or same site; arbitrary cross-site cookie deployments are not supported by the current SameSite strategy. Set trusted proxy configuration explicitly when hosting behind a reverse proxy; the current local server does not assume one. The rate limiter uses process memory and will need a shared store for multiple API instances.

No deployment or external account provisioning has been performed.

## Phase 6 hardening

- General API traffic is limited to 600 requests per IP per 15 minutes, in addition to the existing 20 authentication attempts per 15 minutes and 30 invitations per authenticated manager per hour. Rejections return structured `RATE_LIMITED` errors, standard rate-limit headers, and `Retry-After`. `/health` is excluded from the general API budget. Limits use process memory and need a shared store before scaling to multiple API processes.
- Each request gets a server-generated `X-Request-ID`. JSON completion logs contain only request ID, HTTP method, status and duration. URLs, invitation tokens, query strings, email addresses, IP addresses, cookies, passwords and request bodies are excluded.
- Pagination accepts pages 1–10000 and limits 1–100, rejecting oversized values, arrays and query-operator objects. Mission/comment lists have deterministic timestamp/ID sorting. Existing indexes cover membership uniqueness and lookup, pending invitation uniqueness, token lookup, mission team/status/assignee/date/approval filters, and chronological mission comments. Literal substring search and computed priority sorting still require work proportional to the matching team's data; cursor pagination and measured index tuning remain options for larger teams.
- API boundary tests cover security headers, JSON/body-size errors, safe request logging, request-ID spoofing, rate-limit headers, forwarded-IP spoofing and pagination bounds. Existing integration tests cover unauthorized access, roles, proposal approval, invitation expiry, stale writes, comments and team isolation.

Automated checks do not replace browser verification on the eventual production domain. Mobile layouts, keyboard navigation and sharing invitation links across devices still need that verification before release.

## Next milestone and permission decisions

Phase 6 automated validation and API hardening are implemented; manual browser checks on mobile/desktop and verification behind the actual hosting proxy remain before deployment. Comment policy: current crew members may post/read comments; authors may edit/delete their own comments; the Celestial and Holy Knights may delete others' comments. Managers cannot edit another author's text. Ownership transfer and team deletion are not implemented yet.

Later: hosting. Password reset, account email verification, and profile editing are not implemented yet.

## Task planning

Open a team from the dashboard to see its mission list. The Celestial chooses **Create mission**, adds details, selects a current team member, and sets dates; Holy Knights choose **Propose mission**. Switch to **Kanban board** to view progress; the Celestial can drag missions or use their status selectors. Choose **Open mission & comments** from either view to read details and join the discussion. Use **Members & settings** to manage the team.

Only the **Celestial** can create, edit, assign, change status, and delete missions. **Holy Knights** can propose missions for Celestial approval. **Commoners** can view approved missions and comment, including on missions assigned to them; they cannot create, edit, delete, reassign, move cards or change status. Task IDs are always scoped to the team. Removing a member clears their task assignments without deleting missions they created. Changing status to `done` records completion time; reopening clears it.

Tasks and their latest 200 activity events are stored together so each task change and its history are atomic on local standalone MongoDB. Deletion is a soft delete: the task leaves planning views while its history remains in team activity. This is recent history, not an unlimited audit log. Member removal and assignment reconciliation still involve multiple documents; a replica set and transactions are a later hardening item.

| Method               | Path (under `/api/v1`)                  | Behavior                           |
| -------------------- | --------------------------------------- | ---------------------------------- |
| GET / POST           | `/teams/:teamId/tasks`                  | List or create tasks               |
| GET                  | `/teams/:teamId/tasks/summary`          | Team-wide status totals            |
| GET / PATCH / DELETE | `/teams/:teamId/tasks/:taskId`          | Read, edit, or delete a task       |
| PATCH                | `/teams/:teamId/tasks/:taskId/status`   | Set status                         |
| PATCH                | `/teams/:teamId/tasks/:taskId/assignee` | Set `assigneeId` or null           |
| GET                  | `/teams/:teamId/tasks/:taskId/activity` | Paginated recent task history      |
| GET                  | `/teams/:teamId/activity`               | Paginated recent team task history |

Task fields: `title` (required, max 200), `description` (max 10000), `status` (`todo`, `in_progress`, `in_review`, `done`), `priority` (`low`, `medium`, `high`, `urgent`), nullable `assigneeId`, `startDate`, and `dueDate`. Dates are real calendar dates in `YYYY-MM-DD` form, with due date on or after start date. Update/status/assignee requests accept the returned integer `version`; deletion accepts `?version=...`. The UI always supplies it. Stale writes return 409 so the user can reload the current task.

Task lists accept `page`, `limit`, `q` (literal case-insensitive title/description search), `status`, `priority`, `assignee` (user ID or `unassigned`), `due` (`overdue`, `upcoming`, `undated`), `dueAfter`, `dueBefore`, and `sort` (`newest`, `oldest`, `due`, `priority`). The browser supplies its local calendar `today`; API clients may also supply it (default UTC today). Overdue excludes completed tasks; upcoming covers today through seven days ahead and excludes completed tasks. Range bounds are inclusive. Due-date sorting puts undated tasks first.

Task validation includes isolated database tests for CRUD, membership boundaries, assignment, dates, filters, completion, competing writes, deletion history, and removal cleanup, plus React tests for forms, editing, filtering, list/board moves, and confirmed deletion.

## Mission proposals and approval

Holy Knights choose **Propose mission**, supply details and suggested assignment/dates, and submit it for review. Proposals start as `todo` with `approvalStatus: pending`. They do not appear on mission lists, boards, or totals until approved. The Celestial and Holy Knights can view the **Mission proposals** panel; Commoners cannot access pending/rejected proposal details, history or discussions. Proposals cannot receive comments until approved.

The Celestial opens **Review proposal** and chooses **Approve mission** or **Reject proposal**, optionally providing a rejection reason. Approval activates that same record as a mission visible to the crew. Rejected proposals remain in the review panel and Holy Knights can submit a new proposal. Proposed details stay read-only during review. Only the Celestial can manage an approved mission, including one proposed by a Holy Knight. Comment author editing/deletion and manager moderation remain available on approved missions.

`POST /api/v1/teams/:teamId/tasks/proposals` submits a proposal using the mission fields. `POST /api/v1/teams/:teamId/tasks/:taskId/review` requires `{ decision: approved|rejected, version, reason? }` and Celestial membership. `GET /teams/:teamId/tasks` accepts `approval=approved|pending|rejected` (default `approved`); pending/rejected lists require Celestial or Holy Knights membership. Review permits only one concurrent decision. Approval state, reviewer/time, rejection reason and the activity event are saved atomically in the mission document. Older missions with no approval field remain approved without a data migration, but immediately follow the new Celestial-only management rules.

## Mission discussions

Open a mission and use **Mission discussion** to share progress or ask a question. Comments appear oldest first, 20 per page, with author, posting time, and an **Edited** marker when updated. Posting opens the last page so the saved comment is visible. Use **Refresh** to fetch other crew members' latest comments; live updates and threaded replies are future work. Failed posts retain the draft for retry.

| Method         | Path (under `/api/v1`)                                         | Behavior                                                             |
| -------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| GET / POST     | `/teams/:teamId/tasks/:taskId/comments`                        | Paginated discussion or post `{ body }`                              |
| PATCH          | `/teams/:teamId/tasks/:taskId/comments/:commentId`             | Author edit with `{ body, version }`                                 |
| DELETE         | `/teams/:teamId/tasks/:taskId/comments/:commentId?version=...` | Author or manager deletion                                           |
| PATCH / DELETE | `/comments/:commentId`                                         | Equivalent edit/delete aliases with the same team and mission checks |

Comment text is trimmed, required, limited to 4000 characters, and rendered as plain text. HTML and scripts remain literal text. Every operation checks current team membership and an active mission; nested comment IDs must belong to that mission and team. Removed members lose access, and deleted missions cannot accept or expose discussion comments through these endpoints. The UI sends the comment's returned `version` with writes; stale edits/deletes return 409 and offer a reload.

Comments live in a separate indexed `TaskComment` collection for pagination. Each comment and its latest 200 activity events are saved atomically in that document, independently of the mission version. Mission/team activity combines mission and comment events without including comment bodies. Comment deletion clears its text and retains a deletion event; deleting a mission hides its discussion while preserving team activity. Cross-document mission-deletion races are checked and reconciled after comment creation. This does not provide full multi-document transaction isolation on standalone MongoDB.

Discussion tests use isolated MongoDB instances, not the database configured in `server/.env`. They cover membership/mission boundaries, author editing, manager moderation, revoked access, competing edits, pagination, deleted missions, and activity. Frontend tests cover loading/empty states, posting, editing, paging, confirmation, conflict reload, safe text rendering, and retry drafts.
