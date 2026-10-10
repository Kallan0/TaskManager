# Separate frontend and backend deployment

## Frontend only (current default)

You can deploy the frontend now without creating a Render service. Use Vercel root `client`, install `npm ci --include=dev --include=optional --workspaces=false`, build `npm run build`, output `dist`, and Node 24. No start command or backend URL is needed. Keep `VITE_API_BASE_URL=/api/v1` if setting it explicitly.

The default `client/vercel.json` serves the UI and SPA routes, and returns an explicit 503 for API requests with `X-Planner-Deployment: frontend-only`. The UI explains that the backend is not connected when an API action is attempted. Actual login, registration and mission data require the backend later; this does not create a demo account or fake persisted data.

When ready to connect the backend, replace `client/vercel.json` with the preserved `client/vercel.backend.json`, set Vercel's `RENDER_API_URL` and Render's `CLIENT_URL`, then redeploy. The remainder of this guide describes that connected setup.

Deploy the backend from `server` on Render and the frontend from `client` on Vercel. Each folder has its own TypeScript dependency, Node requirement, sources and complete cross-platform lockfile. Neither deployment requires its sibling or the repository root. The backend does not need a frontend build; combined hosting still works when one is present.

## Render

Create a Node Web Service with these settings:

| Setting           | Value                                                                         |
| ----------------- | ----------------------------------------------------------------------------- |
| Root Directory    | `server`                                                                      |
| Build Command     | `npm ci --include=dev --include=optional --workspaces=false && npm run build` |
| Start Command     | `npm start`                                                                   |
| Health Check Path | `/health`                                                                     |

`server/package-lock.json` enables reproducible standalone installation. The root-level `render.yaml` records these settings for a Blueprint; they can also be entered manually. It does not provision a service until you create one. Choose a service plan explicitly in Render.

Set `NODE_ENV=production`, `NODE_VERSION=24`, `MONGODB_URI` including the intended database name, a private random `SESSION_SECRET` of at least 32 characters, and `CLIENT_URL` to the exact HTTPS frontend origin without a trailing slash. Leave Render's supplied `PORT` in place; the server binds to `0.0.0.0`. Keep `TRUST_PROXY_HOPS=0` until the actual proxy chain is verified. Anonymous requests share the host's ingress IP budget until that verification. Do not place database credentials or the session secret in Vercel's frontend environment.

Allow Render's outbound IP ranges in Atlas Network Access. Before the first production start, back up existing data and run the migration once against the same database configured in Render. From the server folder with that private environment loaded:

```sh
npm run build
DB_ADMIN_CONFIRM=your_exact_database_name npm run db:migrate
npm run db:audit
```

Use a Render shell/pre-deploy step where available, or a trusted local machine with the same database configuration. Changing the service root does not remove the database migration requirement.

Production stops with `DATABASE_MIGRATION_REQUIRED` when the target has not been migrated. Run the full migration once before release; avoid replaying its backfill on every ordinary deploy. In PowerShell from `server`, use `$env:DB_ADMIN_CONFIRM = 'your_exact_database_name'` followed by `npm.cmd run db:migrate` and `npm.cmd run db:audit` after building.

## Vercel

| Setting          | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Root Directory   | `client`                                                     |
| Framework        | Vite                                                         |
| Install Command  | `npm ci --include=dev --include=optional --workspaces=false` |
| Build Command    | `npm run build`                                              |
| Output Directory | `dist`                                                       |
| Start Command    | None                                                         |

For the optional backend-connected configuration, set Node 24, `VITE_API_BASE_URL=/api/v1` and `RENDER_API_URL=https://your-backend.onrender.com`. `RENDER_API_URL` is an HTTPS origin without credentials, paths, query or trailing slash. It is consumed by Vercel routing, not compiled into browser code. Only builds using the backend-connected template require this variable. Files outside the root directory are not required.

Both folders declare their own TypeScript build dependency. Keep development dependencies included during installation; production-only installs omit the compiler and Vite.

The default `client/vercel.json` configures frontend-only hosting. The optional `client/vercel.backend.json` preserves the environment-backed API proxy with the same build/static/security settings. Remove conflicting old dashboard overrides or match the settings above. The backend-connected API route uses Vercel's supported environment expansion:

```json
{
  "routes": [
    {
      "src": "/api(?:/(.*))?",
      "dest": "${RENDER_API_URL}/api/$1",
      "env": ["RENDER_API_URL"]
    }
  ]
}
```

After deployment, verify login, cookie persistence, trusted origins, API errors and refreshed UI routes on the actual frontend domain. Vercel preview domains need their own explicit trusted-origin policy; the production configuration trusts the configured frontend origin only.

The full configuration proxies API paths before static files/SPA fallback, leaves missing assets as 404, prevents API caching, revalidates HTML and marks fingerprinted assets immutable. Cookies stay Secure/HttpOnly/SameSite=Lax, host-only, with `/api/v1` path. The proxy must preserve cookies and the browser's Origin. Direct frontend requests to an unrelated Render domain are not the supported cookie topology.

## Verification

Run `npm run test:deployment` from the repository root. It copies the folders into separate temporary directories, installs each standalone lockfile with production environment and build dependencies, builds each, validates routing, and starts the API without a sibling frontend using a disposable replica set. It checks the migration gate, readiness, cookie attributes, registration/password workers, sessions, transactional writes, origin rejection and logout. It never touches the configured application database. Temporary dependency folders are retained in the system temp directory; the temporary database and API are stopped.

CI checks standalone Linux builds as well as the ordinary regression suite and isolated deployment checks. Keep standalone lockfiles synchronized when changing dependencies, using `--workspaces=false`; maintain the root workspace lockfile too.

Local validation on 10 October 2026: both clean standalone installs/builds and the production API checks passed; 59 frontend tests and 67 API tests passed; 100 responsive Chromium checks passed with the Vercel security headers applied. TypeScript, lint, formatting, patch consistency and cross-platform native lock checks passed. Package versions were preserved. Clean builds were verified locally on Windows; the added Ubuntu CI jobs must still run on GitHub. These results do not prove the live Vercel-to-Render proxy chain or Atlas configuration.

Live proxy/cookie checks, Atlas reachability/migration, verified proxy trust and actual mobile browsers still require real deployment URLs. Render's free service sleeps while idle: cleanup pauses and cold starts can exceed the browser's 12-second timeout. Use an always-on service for regular users.

References: [Vercel environment-backed routes](https://vercel.com/docs/project-configuration/vercel-json#using-environment-variables-in-routes), [Render Blueprint configuration](https://render.com/docs/blueprint-spec), [Atlas network access](https://render.com/docs/connect-to-mongodb-atlas).
