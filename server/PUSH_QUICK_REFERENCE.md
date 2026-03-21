# Push Notifications - Quick Reference

## 1-Minute Setup

```bash
# Step 1: Generate VAPID keys
npm install -g web-push
web-push generate-vapid-keys

# Step 2: Add to .env
VAPID_PUBLIC_KEY=your_key_here
VAPID_PRIVATE_KEY=your_key_here

# Step 3: Rebuild
npm run build
```

## API Endpoints

```bash
# Get VAPID key (public, no auth)
GET /api/notifications/vapid-public-key

# Subscribe device (requires auth)
POST /api/notifications/subscribe
Body: { "subscription": { "endpoint": "...", "keys": {...} } }

# Unsubscribe device (requires auth)
POST /api/notifications/unsubscribe
Body: { "endpoint": "..." }

# Test notification (requires auth)
POST /api/notifications/test
```

## Service Functions

```typescript
import { sendPushToUser, sendPushToRole, NOTIFY } from '../lib/pushService.js';

// Send to single user
await sendPushToUser(userId, NOTIFY.clientApproved('Client Name', 'Post Title'));

// Send to all users with role
await sendPushToRole(agencyId, 'DESIGNER', NOTIFY.taskAssigned(
  'Client',
  'Task',
  'Deadline'
));

// Send to multiple roles
await sendPushToRole(agencyId, ['OWNER', 'ADMIN'], payload);
```

## Available Templates

```typescript
NOTIFY.clientApproved(clientName, postTitle)
NOTIFY.clientChanges(clientName, postTitle)
NOTIFY.designerSubmitted(designerName, taskTitle, clientName)
NOTIFY.taskAssigned(clientName, taskTitle, deadline)
NOTIFY.newRequest(clientName, requestType)
NOTIFY.contentReadyForClient(agencyName, postTitle)
NOTIFY.postPublished(clientName, platform)
NOTIFY.taskOverdue(taskTitle, clientName, daysLate)
NOTIFY.designApproved(taskTitle, clientName)
NOTIFY.designRevision(taskTitle, clientName)
NOTIFY.weeklySummary(clientCount, postsPublished, pendingApprovals)
```

## Frontend (Minimal Example)

```typescript
// 1. Register service worker
navigator.serviceWorker.register('/service-worker.js');

// 2. Get VAPID key
const res = await fetch('/api/notifications/vapid-public-key');
const { publicKey } = await res.json();

// 3. Subscribe
const reg = await navigator.serviceWorker.ready;
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(publicKey),
});

// 4. Send to backend
await fetch('/api/notifications/subscribe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ subscription: sub }),
  credentials: 'include',
});
```

## Custom Payload

```typescript
const customPayload = {
  title: 'Custom Title',
  body: 'Custom message',
  icon: '/icons/icon-192.png',
  badge: '/icons/icon-192.png',
  tag: 'unique-id',
  data: { url: '/custom-page', extra: 'data' },
  actions: [
    { action: 'view', title: 'View' },
    { action: 'dismiss', title: 'Dismiss' },
  ],
};

await sendPushToUser(userId, customPayload);
```

## Files

| File | Purpose |
|------|---------|
| `src/routes/notifications.ts` | API endpoints |
| `src/lib/pushService.ts` | Service + templates |
| `src/db.ts` | Storage functions |
| `src/server.ts` | Route registration |
| `src/types.ts` | Type definitions |

## Documentation

- `PUSH_NOTIFICATIONS.md` - Full docs
- `PUSH_SETUP_GUIDE.md` - Step-by-step setup
- `PUSH_QUICK_REFERENCE.md` - This file

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Not configured" error | Add VAPID keys to .env |
| Service worker fails | Check `/public/service-worker.js` exists |
| Subscriptions not saving | Verify authentication (JWT valid?) |
| No notifications | Check browser notification permissions |
| Subscription 404/410 | Old subscription deleted (automatic cleanup) |

## Production Checklist

- [ ] Generate and add VAPID keys
- [ ] Implement service worker at `/public/service-worker.js`
- [ ] Add subscribe/unsubscribe flows to UI
- [ ] Test push delivery
- [ ] Plan DB migration from JSON
- [ ] Add user notification preferences
- [ ] Set up monitoring/logging
