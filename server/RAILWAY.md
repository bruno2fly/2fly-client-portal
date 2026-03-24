# Railway deploy (api.2flyflow.com)

## Checklist

- **Root directory:** In Railway project settings, set **Root Directory** to `server` (or the path to this folder from repo root).
- **Build:** `npm run build`
- **Start:** `npm run start` → `node dist/server.js` only (does **not** run seed on deploy).
- **One-off admin seed:** `npm run seed` (or `npm run start:with-seed` only when you intentionally want seed + server).

## Environment variables

Set in Railway dashboard for the API service:

| Variable       | Example / note |
|----------------|-----------------|
| `NODE_ENV`     | `production` |
| `FRONTEND_URL` | `https://2flyflow.com` |
| `JWT_SECRET`   | Strong random secret (e.g. `openssl rand -hex 32`) |
| `PORT`         | Leave unset so Railway assigns it, or `3001` if you set it |

## Data Persistence

Railway's filesystem is ephemeral: every deploy creates a new container.

**Solution:** A Railway Volume is mounted at `/app/data` for persistent JSON storage.

- The volume is attached via Railway Dashboard (Settings > Volumes)
- `RAILWAY_VOLUME_MOUNT_PATH` is auto-injected by Railway at runtime
- `db.ts` and `create-admin-user.ts` use this env var to resolve the data directory
- Local development falls back to `process.cwd()/data` (no env var set)

**Important:** If the Railway service **Start Command** was set manually to something like
`sh -c "npm run seed && node dist/server.js"`, change it to `npm run start` (or `node dist/server.js`)
so deploys do not run the seed every time.

The seed script (`create-admin-user.ts`) only touches `agencies.json` and `users.json` — not
`portal-state.json`. It refuses to run if those JSON files exist but are corrupt (invalid JSON),
so it cannot wipe them with empty defaults. Run `npm run seed` manually after first deploy or
when you need to ensure the admin user exists.
