# Deployment plan

Reviewed: 10 October 2026. This is a proposed rollout for the current repository; hosting, infrastructure, load tests, and the prerequisites below have not been implemented by this review.

## Recommended first deployment

Use one always-on Node web service on Render and a MongoDB Atlas replica set, with the browser and API under **one HTTPS origin**. Keep a separate staging service and staging database. Select the service size and Atlas tier after the staging load test; no user capacity or monthly cost is established yet.

The proposed Node service serves the compiled React files and the Express API. **The server currently serves API routes only**, so production static hosting and SPA fallback must be implemented before this topology will work. Render supports Node/Express services with configurable build/start commands: [official deployment guide](https://render.com/docs/deploy-node-express-app).

```text
Browser -> HTTPS hosting proxy -> Node service
                                  /api/v1/* -> Express -> MongoDB Atlas
                                  /health  -> readiness check
                                  assets   -> client/dist
                                  UI URLs  -> client/dist/index.html
```

Same-origin hosting fits the existing HttpOnly, Secure, SameSite=Lax session cookie and `/api/v1` cookie path. It also avoids the previous origin rejection problem. Do not deploy the frontend and API to unrelated provider domains and expect the current cookies to work. A CDN/reverse proxy with static files and `/api` routed to separate Node services is an alternative when traffic justifies it; Express recommends a reverse proxy for production [performance and reliability](https://expressjs.com/en/advanced/best-practice-performance/).

SMTP is unnecessary for invitations. Keep generating a 48-hour link and let the manager share it using any medium. Account identity verification and recovery are separate requirements; see the [multi-user review](multi-user-review.md).

## Phase 1: release prerequisites

Complete these in small, reviewable changes before public access:

1. Add production static serving after API/health routes and before the final 404 handler. SPA fallback must handle UI deep links, including `/invitations/:token`, but must never turn unknown API paths or missing assets into HTML successes. Use Express 5-compatible route syntax. Verify Helmet's CSP with the actual styles/fonts; avoid broad CSP relaxation. Cache fingerprinted assets, revalidate HTML, and do not cache authenticated API responses.
2. Close the invitation identity vulnerability: prevent unverified accounts from discovering or accepting invitations addressed to an email they have merely typed. Preserve link sharing and the no-SMTP requirement. Choose a verified identity provider, or an explicit Celestial approval workflow with no automatic membership grant; do not silently treat a typed address as verified ownership.
3. Make team creation and invitation acceptance atomic across their documents using replica-set transactions. Add bounded, retryable cleanup for member removal and an invariant repair job/report. Test process interruption, transaction retries, and repeated acceptance. Transactions alone do not enforce revocation order without a shared write/version guard.
4. Revise rate-limit budgets for office/shared-network users. Add per-user budgets for authenticated traffic, retaining IP protection for anonymous endpoints. Before two API instances, install a shared store for all three limiters and define store-outage behavior.
5. Require versions on mission/comment update and delete endpoints; keep the existing 409 reload flow. Introduce idempotency keys for mission/proposal/comment creation and reconcile ambiguous network failures before retrying.
6. Add bounded database waits, request cancellation/timeouts, useful readiness checks, safe operation-tagged metrics, and alerts. Validate maximum UTF-8 request sizes against field limits.
7. Define account recovery and Celestial continuity, backup retention, data retention, and incident responsibility. An administrator-controlled recovery process is an option for a closed pilot; changing ownership permissions needs a separate explicit product decision.

The detailed triggers and acceptance checks are in the [review](multi-user-review.md). Do not declare these complete merely because staging boots.

## Phase 2: staging configuration

Use a hosted repository with the existing validation workflow. Pin Node 24 consistently in CI and hosting, and install from the lockfile. Build from the repository root with development build tools available; do not omit development dependencies before compiling.

| Setting             | Proposed value / handling                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Repository root     | Repository root, not `client` or `server`                                                   |
| Build command       | `npm ci && npm run build`                                                                   |
| Start command       | `npm run start -w server`                                                                   |
| `NODE_ENV`          | `production`, including staging                                                             |
| `PORT`              | Hosting-provided port; the server already reads it                                          |
| `CLIENT_URL`        | Exact public HTTPS origin, no path or trailing slash                                        |
| `VITE_API_BASE_URL` | `/api/v1`, set during the frontend build                                                    |
| `MONGODB_URI`       | Separate staging/production secrets, database names, and least-privilege users              |
| `SESSION_SECRET`    | Random high-entropy secret, at least 32 characters, same across replicas of one environment |
| `TRUST_PROXY_HOPS`  | Establish from the actual network path; do not guess or blindly set `1`                     |
| HTTP health path    | `/health`, upgraded as described below                                                      |

Do not upload local `.env` files, reuse the development database for testing, or place secrets in `VITE_*` variables. Frontend environment values become public build assets. Rotate secrets if exposed; session-secret rotation currently signs everybody out.

Validate the host's forwarding behavior and all alternate ingress paths. Every path must have the same trusted proxy depth and strip/replace client-supplied forwarded headers. If the provider cannot guarantee this, replace hop-count trust with an appropriate verified trust policy. Wrong configuration either collapses all users into the proxy's IP budget or permits spoofed rate-limit identity.

Place API and database near each other. Restrict database network access to the service's verified egress/private access where available. Configure backups with a tier that supports the chosen recovery targets, and verify an actual restore into a separate database. Proposed initial targets: recovery point within 24 hours and restoration within 4 hours; revise if users need tighter guarantees. Atlas [connection limits vary by tier](https://www.mongodb.com/docs/atlas/reference/atlas-limits/), so budget pools across all replicas and deployment overlap.

Run explicit index creation/migrations against staging, check uniqueness conflicts, and then use a controlled production migration step rather than implicit index builds on every startup. Keep schema changes compatible with the previous app version during rollout.

## Phase 3: staging acceptance

Run the existing checks on an isolated test database:

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:responsive
```

The responsive check requires an installed compatible Chromium browser. Its API fixtures do not validate the deployed database, cookies, network path, or user capacity. Verify the real staging site at mobile and desktop widths, including Safari/iOS when available.

| Scenario                              | Required result                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Sign in, refresh, deep link, sign out | Secure cookie works; HTML/assets/API route correctly; logout invalidates sessions as documented                          |
| Invitation sharing                    | Copy/share link, correct recipient/identity, wrong account, expiry, revoke, double acceptance, reload after acceptance   |
| Role boundaries                       | Celestial creates/reviews/manages; Holy Knights propose; Commoners view approved missions and comment                    |
| Concurrent changes                    | Exactly one winner for a stale write/review; 409 offers reload and preserves useful user input                           |
| Member removal / deletion             | Removed users lose access; assignments and discussion stay consistent even across retries/restarts                       |
| Origin and proxy                      | Correct public origin accepted, hostile/missing mutation origin rejected, spoofed forwarded headers cannot evade budgets |
| Failure recovery                      | Database interruption, process termination, connection exhaustion, lost response after write, rate-limit-store outage    |
| Restore                               | Restore backup into isolated environment and verify users, memberships, invitations, missions, and comments              |

## Capacity test before rollout

Use staging only, synthetic identities, an isolated seed database, and a load tool such as k6 or Artillery. This test is planned, not already run.

- Seed small crews and a large crew with 100 members, 10,000 missions, 1,000 comments on one mission, and substantial retained activity. Also test many small teams per account; dataset size matters independently of active users.
- Ramp through **20, 50, 100, 250, and 500 concurrently active sessions** with realistic pauses. These are test targets, not supported capacity claims. Begin with one instance and stop the ramp when acceptance thresholds fail.
- Proposed request mix: 60% lists/detail/comments, 15% summaries, 10% activity/search/priority sort, 10% mission/comment writes, 5% login/invitation operations. Test shared-IP office traffic separately. Use role-correct users and distinguish intended 403/409/429 results from failures.
- Hold each stage for 10 minutes; soak the highest passing stage for an hour. Separately burst authentication, remove a heavily assigned member, repeat deep-page searches, and test duplicate writes/concurrent acceptance.
- Proposed gates: ordinary read p95 below 500 ms, writes p95 below 1 second, activity/search p95 below 2 seconds, unexpected failures below 1%, no invariant violations or unintended 429s, and CPU/memory/DB connection headroom of at least 30% at steady load. Measure event-loop lag, DB wait times and timeout counts, not just averages.
- Record commit, instance/DB sizes, seed sizes, actual requests per second, latency percentiles, errors, pool use, memory, and maximum passing stage. Re-test after changes. Designate a pilot ceiling below the measured limit with explicit headroom.

## Phase 4: pilot, production, rollback

1. Release to a small closed pilot after the prerequisite and staging gates pass. Monitor for at least 48 hours before widening access. App owner handles deployment/rollback; backend owner handles DB invariants/migrations; QA owner records role, mobile, and concurrency results. In a one-person project these are responsibilities, not extra staffing requirements.
2. Publish production only after restoring a backup successfully, recording the prior deploy artifact, and documenting required migrations and rollback compatibility. Verify HTTPS, origin, cookies, deep links, invite sharing, role permissions, and health on the final domain.
3. Configure alerts for unhealthy service, elevated unexpected 5xx, p95 latency breach, connection-pool waits, sustained CPU/memory pressure, and unusual 429/conflict rates. Keep sanitized request IDs and operation names; invitation URLs/tokens, credentials, cookie values, and comment bodies must stay out of logs and analytics.
4. Upgrade `/health` from connection-state inspection to bounded, cached database readiness plus a shutdown flag. Keep a separate process-liveness signal if the host supports it; avoid restart storms during database outages. Render uses HTTP health checks to gate new deployments and route around unhealthy instances: [health-check documentation](https://render.com/docs/health-checks).
5. Roll back the app to the previous compatible artifact when health fails or error/latency gates remain breached for 5 minutes. Stop rollout immediately for unauthorized access or consistency loss. Disable the affected mutation workflow while investigating; do not restore a production backup over newer writes as a routine app rollback. Repair data separately with an audited plan.

## Phase 5: scaling after measurement

First remove unbounded member/assignment fan-out and expensive activity queries, then tune indexes using real query plans. Add cursor pagination and searchable member selection. Scale the single Node instance vertically if CPU is limiting; profile bcrypt authentication separately from ordinary traffic.

Add a second Node instance only with shared rate-limit storage, consistent session secrets, bounded pool settings, verified proxy routing, and concurrency tests. Keep Atlas connection headroom during rolling deployments. Add a CDN for immutable frontend assets when needed. Add SSE or conservative polling for collaboration only with a measured request budget; the current UI has no realtime updates.

Do not start with Kubernetes, sharding, or a rewrite. Choose those only if measurements show a problem that simpler deployment and query improvements cannot solve.
