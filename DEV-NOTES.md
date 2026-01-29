# Dev Notes: Multi-User Agency Dashboard

## Agency-scoped dashboard

**All agency dashboard data is scoped by `agencyId`, not `userId`.**

- Clients, portal state (tasks, requests, approvals, assets), and client credentials are stored server-side and filtered by `agencyId`.
- Every staff account in the same agency (same `agencyId`) sees the **same** clients, tasks, requests, stats, etc.
- Use `getAgencyScope(req)` in backend routes and scope all dashboard queries by `req.auth.agencyId` (or `req.user.agencyId`).

## userId vs agencyId

- **`userId`**: Use only for audit logs, "actor" attribution, and **personal preferences** (e.g. last selected client, UI prefs). Never use `userId` to filter dashboard data.
- **`agencyId`**: Use for all dashboard data (clients, portal state, assets, etc.). Shared across OWNER, ADMIN, and STAFF in the same agency.

## RBAC

- **CanViewDashboard** = OWNER, ADMIN, STAFF. All can see the same agency dashboard.
- **CanManageUsers** = OWNER, ADMIN. Only these can invite, delete, or change user roles.

## API

- **`/api/agency/*`**: Agency-scoped; requires `authenticate` + `requireCanViewDashboard`. Uses `getAgencyScope(req).agencyId`.
- **`/api/users`**: List scoped by `actorUser.agencyId`. Invite/delete require `requireCanManageUsers`.

## Migration

- Run `npm run migrate:agency-scope` in `server/` to ensure agency "2Fly" exists and to backfill `agencyId` on assets.
