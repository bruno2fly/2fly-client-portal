# 2FLY Flow — Claude Operating Protocol
**Read this ENTIRE file before doing anything. No exceptions.**

This is a live production app. Real clients use it daily. Bruno's agency revenue depends on it being online. It has broken 3 times in 2 weeks from AI agents not following safe practices. This file exists to stop that.

---

## 🚨 THE 5 RULES — NEVER BREAK THESE

### Rule 1 — BACKUP BEFORE ANYTHING
```bash
node backup-db.js
```
Confirm backup file exists with real data before proceeding. If backup fails → **STOP. Do not continue.**

### Rule 2 — NEVER CHANGE AUTH/ENV VARS
- **Never change `JWT_SECRET`** — this immediately logs out ALL users
- Never add, remove, or change environment variables without listing exactly what you're changing and why, then waiting for Bruno's explicit approval
- The current env vars on Render are correct. Do not touch them unless Bruno explicitly says to.

### Rule 3 — NEVER RUN MIGRATIONS ON PROD DIRECTLY
- Test migrations locally first
- Never run `prisma migrate deploy` or `prisma db push` on production without Bruno's approval
- Always have a rollback plan written out BEFORE running any migration

### Rule 4 — IF SOMETHING BREAKS → STOP AND REPORT
- Do NOT try to fix your own mistake with more changes
- Stop immediately, write exactly what you changed, and wait for Bruno
- Every recovery attempt that goes wrong makes it worse
- This is how a 30-second mistake becomes a 3-hour outage

### Rule 5 — VERIFY BEFORE CLOSING
After every deploy, confirm ALL of these:
- [ ] `curl https://api.2flyflow.com/health` returns 200
- [ ] Login works at 2flyflow.com
- [ ] At least one client's data loads
- [ ] No errors in Render logs

---

## 📋 SAFE TO CHANGE vs NEVER TOUCH

### ✅ SAFE TO CHANGE
- Frontend UI (HTML/CSS/JS in `public/`)
- API endpoint logic (no schema changes)
- Adding new routes that don't modify existing data
- Frontend-only performance improvements

### ⛔ NEVER TOUCH WITHOUT BACKUP + APPROVAL
- `server/prisma/schema.prisma` — schema changes = migration = risk
- `server/src/server.ts` — auth middleware lives here
- Any environment variable on Render
- `JWT_SECRET`, `DATABASE_URL`, `SESSION_SECRET`
- Render plan/billing settings

---

## 🏗️ STACK REFERENCE

| Component | Location | Notes |
|-----------|----------|-------|
| Frontend | Vercel (2flyflow.com) | Auto-deploys from main branch |
| Backend API | Render (api.2flyflow.com) | Manual or auto deploy |
| Database | Render Managed Postgres (db_2flyflow_db) | Oregon region |
| ORM | Prisma | Migrations in server/prisma/migrations/ |
| Auth | JWT via httpOnly cookie | Secret must stay consistent |
| Image uploads | Vercel Blob | BLOB tokens set in Render env |

---

## 💾 BACKUP REFERENCE

Backup script: `backup-db.js` in repo root
Last known good backup: `~/Downloads/backup-2flyflow-2026-05-07-portal-states.json` (1,221KB)
Last known good backup: `~/Downloads/backup-2flyflow-2026-05-07-tables.json` (146KB)
Recovery script: `server/src/scripts/recover-from-backup.ts`

---

## 👥 WHO USES THIS APP

- **Bruno Lima** — admin@2flyflow.com (OWNER)
- **Milena** — mileguimaraess — Social Media Manager
- **Gui** — g.alvesilvaa@gmail.com — Designer
- **Igor** — igor.m.tavares@gmail.com — Designer
- **~10 clients** — approve posts, send requests, view content

If you change JWT_SECRET, ALL users get logged out instantly. They will call Bruno.

---

## 🔴 KNOWN INCIDENTS

### May 7, 2026 — Auth Break
Claude set a new `JWT_SECRET` during bandwidth optimization. Invalidated all sessions.
**Fix:** Removed JWT_SECRET, redeployed. Users logged out + back in.
**Lesson:** Never change JWT_SECRET.

### Prior x2 incidents
Postgres migrations broke and caused data loss.
**Lesson:** Always backup. Always test locally first.

---

## ✅ PRE-SESSION CHECKLIST

Before writing a single line of code:
1. [ ] Read this file fully
2. [ ] Run `node backup-db.js` — confirm it worked
3. [ ] State the ONE thing we are changing today
4. [ ] Confirm: does it touch the DB schema? (extra caution if yes)
5. [ ] Confirm: does it touch env vars? (stop if yes, wait for Bruno)
6. [ ] State rollback plan

**One thing at a time. Backup first. Verify after. Stop if anything breaks.**
