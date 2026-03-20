# 2FlyFlow Client Portal — Dev Agent Guide

> Reference for AI dev agents working on this codebase remotely.
> Last updated: March 18, 2026

---

## Project Overview

Social media agency management platform. Agency staff manage clients, create content calendars, schedule posts to Facebook/Instagram, and clients have their own portal to review and approve content.

**Live URL:** https://2flyflow.com
**API URL:** https://api.2flyflow.com
**Repo:** https://github.com/bruno2fly/2fly-client-portal

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS + HTML/CSS (NO React in production pages) |
| Backend | Node.js + Express + TypeScript |
| Database | JSON files on disk (Railway volume in prod) |
| Auth | JWT cookies (`2fly_session`, 7-day expiry) |
| File Storage | Vercel Blob |
| Integrations | Meta Graph API v21.0, Google Drive, OpenAI |
| Deployment | Vercel (frontend + serverless API) |
| Mobile | Capacitor iOS (loads from production URL) |
| Cron | Vercel Cron Jobs |

---

## Directory Structure

```
2fly-client-portal/
├── public/                    # SERVED STATIC FILES (this is the frontend)
│   ├── agency.html            # Agency dashboard page
│   ├── agency.js              # Agency dashboard logic (~8000+ lines)
│   ├── index.html             # Client portal (all-in-one HTML+CSS+JS)
│   ├── login.html             # Client login
│   ├── staff-login.html       # Staff/agency login
│   ├── accept-invite.html     # User invitation acceptance
│   ├── forgot-password.html
│   ├── reset-password.html
│   ├── sw.js                  # Service worker (network-first cache)
│   └── manifest.webmanifest   # PWA manifest
├── server/
│   ├── src/
│   │   ├── server.ts          # Express app entry point
│   │   ├── db.ts              # JSON file read/write (all data access)
│   │   ├── types.ts           # TypeScript interfaces
│   │   ├── middleware/
│   │   │   └── auth.ts        # JWT auth + role checks
│   │   ├── routes/
│   │   │   ├── auth.ts        # Login, logout, password reset
│   │   │   ├── users.ts       # User CRUD, invites
│   │   │   ├── agency.ts      # Client management
│   │   │   ├── clientPortal.ts # Client dashboard state
│   │   │   ├── production.ts  # Designer workflow/tasks
│   │   │   ├── designers.ts   # Designer management
│   │   │   ├── metaAuth.ts    # Facebook/Instagram OAuth flow
│   │   │   ├── meta.ts        # Meta status, debug, disconnect
│   │   │   ├── posts.ts       # Schedule/publish posts
│   │   │   ├── cron.ts        # Cron: publish, refresh tokens, retry
│   │   │   ├── googleDrive.ts # Google Drive integration
│   │   │   ├── upload.ts      # Image upload to Vercel Blob
│   │   │   └── aiCopilot.ts   # OpenAI caption generation
│   │   ├── lib/
│   │   │   └── meta-api.ts    # Meta Graph API wrapper functions
│   │   └── utils/
│   │       ├── auth.ts        # Password hashing, token gen
│   │       ├── email.ts       # Email sending
│   │       ├── crypto.ts      # Encryption helpers
│   │       └── rateLimit.ts   # Rate limiting
│   ├── data/                  # JSON data files (local dev)
│   ├── dist/                  # Compiled JS output
│   ├── package.json
│   └── tsconfig.json
├── vercel.json                # Deployment config + cron schedules
└── capacitor.config.ts        # iOS app config
```

---

## Critical Rules (READ THIS FIRST)

### 1. Cache Busting is MANDATORY

`agency.html` loads `agency.js` with a version parameter:
```html
<script src="/agency.js?v=70"></script>
```

**Every time you edit `agency.js`, you MUST increment the version number in `agency.html`.** If you don't, users will get cached old JS and nothing will work. Current version: **v=70**.

### 2. Frontend is Vanilla JS — NOT React

The `public/` folder is served as-is. `agency.js` and `index.html` are hand-written vanilla JavaScript. There is NO build step for the frontend. Do NOT:
- Import React components
- Use JSX syntax
- Use ES modules (`import`/`export`) in frontend files
- Use `async/await` in older browser patterns (use `.then()` chains for event handlers if needed, though `async` functions work in modern contexts)

### 3. Backend MUST Be Built

After editing any file in `server/src/`, run:
```bash
cd server && npm run build
```
This compiles TypeScript to `server/dist/`. The compiled JS is what Vercel deploys.

### 4. Git Push = Auto Deploy

Pushing to `main` triggers Vercel deployment automatically. Make sure the build succeeds BEFORE pushing.

### 5. Multi-Tenant Scoping

ALL data is scoped by `agencyId`. Every API endpoint that touches data must filter by the authenticated user's `agencyId`. Never return data from other agencies.

---

## Frontend Patterns (agency.js)

### DOM Helpers

```javascript
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  kids.forEach(k => node.append(k));
  return node;
};
```

Use `el()` for creating DOM nodes, `$()` for selecting. Most rendering uses `innerHTML` string concatenation for speed.

### API Calls

```javascript
function getApiBaseUrl() {
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return 'https://api.2flyflow.com';
  }
  return window.__2FLY_API_BASE__ || 'http://localhost:3004';
}

// Always include credentials for cookie auth
fetch(getApiBaseUrl() + '/api/endpoint', {
  method: 'GET',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' }
});
```

**ALWAYS** use `credentials: 'include'` on every fetch call. Without it, the JWT cookie won't be sent and the request will fail with 401.

### State Management

```javascript
// Global state
let currentClientId = null;       // Active client
let currentTab = 'dashboard';     // Active tab
let currentViewMode = 'dashboard'; // dashboard | production

// Portal state per client (loaded from API)
let portalStateCache = {};        // { clientId: stateObject }
let portalStateFetched = new Set(); // Track which clients have been fetched

// Functions
load()  // Returns cached portal state for currentClientId
save(x) // Persists state to API (blocked until fetched from API first)
```

**IMPORTANT:** Never call `save()` before `fetchPortalStateFromAPI()` has completed for that client. It will overwrite server data with empty state.

### Render Flow

```javascript
function renderAll() {
  ensureScheduledTabExists();
  renderClientsSidebar();
  renderClientHeader();
  updateGlobalStatusSummary();
  renderNotificationBell();
  switchTab(currentTab);
}
```

After making data changes, call `renderAll()` or the specific render function for the section you changed.

### Adding a New Tab

1. Add the tab button in `renderClientsSidebar()` or the tab bar
2. Create a `renderYourNewTab()` function
3. Wire it in `switchTab()` with a case for your tab name
4. Make sure `data-tab="yourTabName"` attribute is set

### HTML String Patterns

Most UI is built via string concatenation:
```javascript
var html = '<div style="padding:16px;">';
html += '<h3>' + escapeHtml(title) + '</h3>';
html += '<button class="btn btn-primary" id="myBtn">Click</button>';
html += '</div>';
container.innerHTML = html;

// Then attach events AFTER setting innerHTML
$('#myBtn').addEventListener('click', function() { ... });
```

### Media Helper (for video support)

```javascript
function isVideoUrl(url) {
  if (!url) return false;
  var lower = url.toLowerCase();
  return lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm') ||
         lower.includes('video/') || /[?&]format=video/.test(lower);
}

function mediaTag(url, alt, style) {
  if (isVideoUrl(url)) {
    return '<video src="..." preload="metadata" muted playsinline loop onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0;"></video>';
  }
  return '<img src="..." alt="...">';
}
```

Use `mediaTag()` instead of raw `<img>` tags when displaying user-uploaded content.

---

## Backend Patterns (server/src/)

### Adding a New Route

1. Create file in `server/src/routes/yourRoute.ts`
2. Use this template:
```typescript
import { Router } from 'express';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

router.get('/endpoint', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    // Your logic here - always scope by agencyId
    res.json({ success: true, data: ... });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

export default router;
```

3. Register in `server/src/server.ts`:
```typescript
import yourRoute from './routes/yourRoute.js';
app.use('/api/your-path', yourRoute);
```

4. Build: `cd server && npm run build`

### Auth Middleware

```typescript
authenticate                // Extract user from JWT cookie (required on all protected routes)
requireCanViewDashboard     // OWNER, ADMIN, STAFF only
requireCanManageUsers       // OWNER, ADMIN only
requireProductionAccess     // OWNER, ADMIN, STAFF, DESIGNER
requireAgencyOnly           // No DESIGNER role
```

### Database (db.ts)

JSON file storage. Key functions:
```typescript
// Read/write raw JSON
readJSON(filename)   // Returns parsed JSON or default
writeJSON(filename, data)  // Writes to data/ directory

// Specific data accessors
getClient(clientId)
getClients()                         // All clients
getClientsByAgency(agencyId)         // Scoped
saveClient(client)
deleteClient(clientId)

getMetaIntegrationByClient(agencyId, clientId)
saveMetaIntegration(integration)
deleteMetaIntegrationByClient(agencyId, clientId)
getMetaIntegrations()                // All (for cron jobs)

getScheduledPosts()
getScheduledPostsByAgency(agencyId)
getScheduledPostById(id)
saveScheduledPost(post)
deleteScheduledPost(id)
```

Data files live in `server/data/` locally, or `RAILWAY_VOLUME_MOUNT_PATH` in production.

### TypeScript Interfaces (types.ts)

Key types to know:
```typescript
interface MetaIntegration {
  id: string;
  agencyId: string;
  clientId: string;
  metaAccessToken: string;       // Page token (for publishing)
  metaUserAccessToken?: string;  // User token (for refreshing)
  metaPageId: string;
  metaPageName?: string;
  metaInstagramAccountId?: string;
  metaInstagramUsername?: string;
  tokenExpiresAt: number;        // Unix timestamp ms
  connectedAt: number;
  updatedAt: number;
}

interface ScheduledPost {
  id: string;
  agencyId: string;
  clientId: string;
  contentId: string;
  caption: string;
  mediaUrl: string;
  platforms: ('instagram' | 'facebook')[];
  scheduledAt: string;           // ISO date string
  timezone: string;
  status: 'scheduled' | 'publishing' | 'published' | 'failed';
  error?: string;
  publishedAt?: string;
  metaPostIds?: { instagram?: string; facebook?: string };
  createdAt: string;
  updatedAt: string;
}
```

---

## Meta (Facebook/Instagram) Integration

### OAuth Flow
1. Frontend calls `GET /api/auth/meta?clientId=xxx`
2. Server returns Facebook OAuth URL
3. User approves permissions in Facebook popup
4. Callback at `GET /api/auth/meta/callback` exchanges code for tokens
5. Stores both user token (long-lived, 60 days) and page token

### Required Scopes
```
pages_manage_posts, pages_read_engagement, pages_show_list,
instagram_basic, instagram_content_publish, business_management
```

### Token Lifecycle
- User token: 60 days, refreshable via `fb_exchange_token` grant
- Page token: Derived from user token via `/me/accounts`
- Auto-refresh: Cron runs daily, refreshes tokens expiring within 14 days
- On publish: Refreshes page token from user token before every publish

### Publishing Flow
1. **Facebook photo:** `POST /{pageId}/photos` with `{ url, caption }`
2. **Facebook text:** `POST /{pageId}/feed` with `{ message }`
3. **Instagram:** Two-step: `POST /{igId}/media` (create container) → `POST /{igId}/media_publish` (publish)

---

## Vercel Cron Jobs

Defined in `vercel.json`, handled in `server/src/routes/cron.ts`:

| Schedule | Endpoint | Purpose |
|----------|----------|---------|
| Every 5 min | `/api/cron/publish-posts` | Publish posts where scheduledAt <= now |
| Daily 6am | `/api/cron/refresh-tokens` | Refresh Meta tokens expiring within 14 days |
| Every 30 min | `/api/cron/retry-failed` | Retry token-related failures from last 24h |

Auth: `CRON_SECRET` env var, sent as `Bearer` token or `?secret=` query param.

---

## Environment Variables

```
# Auth
JWT_SECRET=               # Required in production
NODE_ENV=production

# Server
PORT=3001
FRONTEND_URL=https://2flyflow.com
CRON_SECRET=

# Meta (Facebook/Instagram)
META_APP_ID=3833639426945162
META_APP_SECRET=
META_REDIRECT_URI=

# Google Drive
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_TOKEN_SECRET=

# File Storage
BLOB_PUBLIC_READ_WRITE_TOKEN=

# AI
OPENAI_API_KEY=

# Database
RAILWAY_VOLUME_MOUNT_PATH=   # Production persistent storage
```

---

## Common Tasks Checklist

### Editing the Agency Dashboard UI
1. Edit `public/agency.js`
2. Increment version in `public/agency.html`: `<script src="/agency.js?v=XX"></script>`
3. Commit and push

### Editing the Client Portal UI
1. Edit `public/index.html` (CSS + HTML + JS all in one file)
2. Commit and push

### Adding a Backend Endpoint
1. Edit or create route file in `server/src/routes/`
2. Register route in `server/src/server.ts` if new file
3. Run `cd server && npm run build`
4. Commit compiled output AND source
5. Push

### Modifying Data Models
1. Update interface in `server/src/types.ts`
2. Update read/write functions in `server/src/db.ts`
3. Update any routes that use the model
4. Build and push

---

## Style Guide

### Colors
- Primary blue: `#1e40af`
- Light blue bg: `#dbeafe`
- Success green: `#059669`
- Warning amber: `#b45309`
- Error red: `#dc2626`
- Text primary: `#0f172a`
- Text secondary: `#64748b`
- Border: `#e2e8f0`

### UI Conventions
- Border radius: `14px` for cards, `8px` for buttons, `20px` for pills/headers
- Font: Montserrat (loaded from Google Fonts)
- Mobile breakpoint: `768px`
- Header gradient: `linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)`
- Dark mode: `body[data-theme="dark"]` with CSS variable overrides

### Button Classes
```html
<button class="btn btn-primary">Primary Action</button>
<button class="btn btn-secondary">Secondary</button>
<button class="btn btn-secondary" style="color:#dc2626;border-color:#fecaca;">Danger</button>
```

---

## Git Workflow

- **Branch:** `main` (direct push, auto-deploys to Vercel)
- **Commit style:** Conventional — `fix:`, `feat:`, `chore:`, etc.
- **Author:** `bruno2fly <2flydigitalmarketing@gmail.com>`
- **ALWAYS build before pushing:** `cd server && npm run build`
- **ALWAYS bump cache version** if `agency.js` was modified

---

## Pitfalls to Avoid

1. **Forgetting `credentials: 'include'`** on fetch calls → 401 errors
2. **Forgetting cache bust version** → users see old JS
3. **Not building server** before push → Vercel deploys old compiled code
4. **Using React/JSX in public/ files** → syntax errors in browser
5. **Not scoping by agencyId** → data leak between agencies
6. **Calling save() before fetch** → overwrites server state with empty data
7. **Using page token for `/me/permissions`** → only user tokens work
8. **Editing `server/dist/` directly** → gets overwritten on next build
9. **Adding unapproved Meta scopes** → Facebook shows "Invalid Scopes" error
10. **Pushing without testing build** → broken deployment
