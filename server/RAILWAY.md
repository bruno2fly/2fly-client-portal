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

## Ephemeral filesystem

Railway’s filesystem is ephemeral: **every deploy wipes `data/`**. The start script runs `create-admin-user.ts` before starting the server so the admin user (and default agency) exist after each deploy. All other data (clients, invites, etc.) is lost on redeploy until you move to a persistent database (e.g. Railway PostgreSQL).
