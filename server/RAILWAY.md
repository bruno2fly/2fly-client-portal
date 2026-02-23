# Railway deploy (api.2flyflow.com)

## Checklist

- **Root directory:** In Railway project settings, set **Root Directory** to `server` (or the path to this folder from repo root).
- **Build:** `npm run build`
- **Start:** `npm run start` (runs seed then `node dist/server.js`)

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

**Important:** The `create-admin-user.ts` seed script runs on every deploy (`npm run start`).
It only creates `agencies.json` and `users.json` if they don't already exist — it does NOT
overwrite existing data. This is safe with the Volume because files persist across deploys.
