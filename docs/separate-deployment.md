# Separate frontend and backend deployment

Deploy the backend from `server` on Render and the frontend from `client` on Vercel. The backend does not need a frontend build. When a frontend build exists alongside the server, combined hosting still works.

## Render

Create a Node Web Service with these settings:

| Setting           | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| Root Directory    | `server`                                                        |
| Build Command     | `npm install --include=dev --include=optional && npm run build` |
| Start Command     | `npm start`                                                     |
| Health Check Path | `/health`                                                       |

The root workspace lockfile is outside this directory, so use `npm install` rather than `npm ci` for this standalone folder. Dependencies use the ranges in `server/package.json`; standalone installs do not have the reproducibility of the repository's root lockfile.

Set `NODE_ENV=production`, `NODE_VERSION=24`, `MONGODB_URI`, a private random `SESSION_SECRET` of at least 32 characters, and `CLIENT_URL` to the exact HTTPS frontend origin without a trailing slash. Leave Render's supplied `PORT` in place. Keep `TRUST_PROXY_HOPS=0` until the actual proxy chain is verified.

Allow Render's outbound IP ranges in Atlas Network Access. Before the first production start, back up existing data and run the migration once against the same database configured in Render. From the server folder with that private environment loaded:

```sh
npm run build
DB_ADMIN_CONFIRM=your_exact_database_name npm run db:migrate
npm run db:audit
```

Use a Render shell/pre-deploy step where available, or a trusted local machine with the same database configuration. Changing the service root does not remove the database migration requirement.

## Vercel

| Setting          | Value           |
| ---------------- | --------------- |
| Root Directory   | `client`        |
| Framework        | Vite            |
| Build Command    | `npm run build` |
| Output Directory | `dist`          |
| Start Command    | None            |

Set `VITE_API_BASE_URL=/api/v1`. Enable inclusion of files outside the root directory for the shared npm workspace configuration. The browser should send API requests through Vercel instead of directly to a different site's Render URL.

Create `client/vercel.json` using the actual Render hostname in place of the example:

```json
{
  "rewrites": [
    {
      "source": "/api/v1/:path*",
      "destination": "https://YOUR-RENDER-SERVICE.onrender.com/api/v1/:path*"
    },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

After deployment, verify login, cookie persistence, trusted origins, API errors and refreshed UI routes on the actual frontend domain. Vercel preview domains need their own explicit trusted-origin policy; the production configuration trusts the configured frontend origin only.
