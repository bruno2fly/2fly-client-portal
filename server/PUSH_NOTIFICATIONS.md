# Push Notifications Backend for 2FlyFlow

Complete push notification system for the 2FlyFlow client portal with web push support, VAPID configuration, and dopamine-friendly notification templates.

## Features

✅ **Web Push Support** - Uses `web-push` library with VAPID authentication
✅ **User Subscriptions** - Subscribe/unsubscribe endpoints for managing push subscriptions
✅ **Role-based Notifications** - Send notifications to specific user roles in an agency
✅ **Dopamine Templates** - Pre-built notification templates optimized for engagement
✅ **Persistent Storage** - Push subscriptions stored in JSON files (easily migrate to DB later)
✅ **Error Handling** - Automatic cleanup of expired/invalid subscriptions

## Files Added/Modified

### New Files
- `/server/src/routes/notifications.ts` - Push notification API endpoints
- `/server/src/lib/pushService.ts` - Core push notification service with templates
- `/server/PUSH_NOTIFICATIONS.md` - This documentation

### Modified Files
- `/server/src/types.ts` - Added `PushSubscriptionRecord` interface
- `/server/src/db.ts` - Added push subscription storage functions
- `/server/src/server.ts` - Registered notification routes

## Environment Setup

Set these variables in your `.env` file:

```bash
# VAPID keys for Web Push (generate with: npm run generate:vapid)
VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
```

### Generating VAPID Keys

Install the `web-push` CLI globally:
```bash
npm install -g web-push
```

Generate keys:
```bash
web-push generate-vapid-keys
```

Copy the output to your `.env` file.

## API Endpoints

### GET /api/notifications/vapid-public-key
Returns the VAPID public key for frontend service worker registration.

**Response:**
```json
{
  "publicKey": "your_public_key"
}
```

**Error:** Returns 503 if VAPID keys not configured.

---

### POST /api/notifications/subscribe
Register a browser's push subscription for the authenticated user.

**Headers:**
- `Authorization: Bearer <jwt_token>` or `Cookie: 2fly_session=<token>`

**Request Body:**
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/...",
    "keys": {
      "p256dh": "base64_encoded_key",
      "auth": "base64_encoded_key"
    }
  }
}
```

**Response:**
```json
{
  "success": true
}
```

**Errors:**
- 400: Missing or invalid subscription object
- 401: Not authenticated

---

### POST /api/notifications/unsubscribe
Remove a push subscription for the authenticated user.

**Headers:**
- `Authorization: Bearer <jwt_token>` or `Cookie: 2fly_session=<token>`

**Request Body:**
```json
{
  "endpoint": "https://fcm.googleapis.com/..."
}
```

**Response:**
```json
{
  "success": true
}
```

**Errors:**
- 400: Missing endpoint
- 401: Not authenticated

---

### POST /api/notifications/test
Send a test push notification to the authenticated user.

**Headers:**
- `Authorization: Bearer <jwt_token>` or `Cookie: 2fly_session=<token>`

**Response:**
```json
{
  "success": true
}
```

Test notification:
- **Title:** "Hey, it works! 🎉"
- **Body:** "Push notifications are live on 2FlyFlow. You're all set!"

---

## Service Functions

### `sendPushToUser(userId: string, payload: PushPayload): Promise<void>`

Send a notification to a specific user's all subscriptions.

```typescript
import { sendPushToUser } from './lib/pushService.js';

await sendPushToUser('user_123', {
  title: 'Custom Title',
  body: 'Custom message body',
  icon: '/icons/icon-192.png',
  data: { url: '/custom-page' }
});
```

### `sendPushToRole(agencyId: string, role: string | string[], payload: PushPayload): Promise<void>`

Send a notification to all users with a specific role.

```typescript
import { sendPushToRole } from './lib/pushService.js';

// Notify all designers in an agency
await sendPushToRole('agency_123', 'DESIGNER', NOTIFY.taskAssigned(
  'Acme Corp',
  'Instagram Post',
  'Tomorrow 5pm'
));

// Notify multiple roles
await sendPushToRole('agency_123', ['OWNER', 'ADMIN'], payload);
```

---

## Notification Templates

All templates are in `NOTIFY` object in `pushService.ts`. They return a `PushPayload` with pre-formatted messages.

### Available Templates

#### 1. `clientApproved(clientName, postTitle)`
When a client approves content.
- **Title:** "Approved! [Client] loved it 🎉"
- **Action:** "View"
- **Link:** Agency approvals tab

#### 2. `clientChanges(clientName, postTitle)`
When a client requests changes.
- **Title:** "[Client] left feedback 💬"
- **Action:** "See feedback"
- **Link:** Agency approvals tab

#### 3. `designerSubmitted(designerName, taskTitle, clientName)`
When a designer submits work for review.
- **Title:** "[Designer first name] just delivered! 👀"
- **Actions:** "Review now"
- **Link:** Production view

#### 4. `taskAssigned(clientName, taskTitle, deadline)`
When a new task is assigned to a designer.
- **Title:** "New mission incoming! 🎯"
- **Action:** "Start working"
- **Link:** Production view

#### 5. `newRequest(clientName, requestType)`
When a client makes a new request.
- **Title:** "New request from [Client] 📬"
- **Action:** "View request"
- **Link:** Requests tab

#### 6. `contentReadyForClient(agencyName, postTitle)`
When content is ready for client approval.
- **Title:** "Fresh content ready! ✨"
- **Action:** "Review now"

#### 7. `postPublished(clientName, platform)`
When content is published to social media.
- **Title:** "Just went live! 🚀"
- **Body:** "[Client]'s post is now on [Platform]"
- **Link:** Scheduled tab

#### 8. `taskOverdue(taskTitle, clientName, daysLate)`
Overdue task reminder.
- **Title:** "Heads up — [X days overdue] ⏰"
- **Action:** "Open task"
- **Link:** Production view

#### 9. `designApproved(taskTitle, clientName)`
When a designer's work is approved.
- **Title:** "Your work is approved! 🏆"
- **Body:** "[Task] for [Client] passed review"

#### 10. `designRevision(taskTitle, clientName)`
When a designer needs to revise work.
- **Title:** "Quick revision needed ✏️"
- **Action:** "See notes"
- **Link:** Production view

#### 11. `weeklySummary(clientCount, postsPublished, pendingApprovals)`
Weekly performance summary.
- **Title:** "Your week in review 📊"
- **Body:** Stats on clients, posts, and pending approvals
- **Link:** Agency dashboard

---

## Usage Examples

### In a Route Handler

```typescript
import { sendPushToUser, NOTIFY } from '../lib/pushService.js';

// When a client approves content
app.post('/api/client/approve', authenticate, async (req, res) => {
  const { contentId } = req.body;
  const clientId = req.user.clientId;

  // ... approval logic ...

  // Notify agency staff
  const agencyId = req.user.agencyId;
  const staff = getUsersByAgency(agencyId).filter(u => u.role === 'STAFF');

  for (const staffMember of staff) {
    await sendPushToUser(staffMember.id, NOTIFY.clientApproved('Acme Corp', 'Q1 Promo'));
  }

  res.json({ success: true });
});
```

### In a Cron Job

```typescript
import { sendPushToRole, NOTIFY } from '../lib/pushService.js';

// Weekly summary notification
app.post('/api/cron/weekly-summary', async (req, res) => {
  const agencies = getAgencies();

  for (const agency of Object.values(agencies)) {
    const posts = getScheduledPostsByAgency(agency.id);
    const clients = getClientsByAgency(agency.id);
    const tasks = getProductionTasksByAgency(agency.id);

    const published = posts.filter(p => p.status === 'published').length;
    const pending = tasks.filter(t => t.status === 'review').length;

    await sendPushToRole(
      agency.id,
      ['OWNER', 'ADMIN', 'STAFF'],
      NOTIFY.weeklySummary(clients.length, published, pending)
    );
  }

  res.json({ success: true });
});
```

---

## Frontend Integration

### Service Worker Setup (service-worker.js)

```javascript
// Handle push events
self.addEventListener('push', event => {
  const data = event.data.json();

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag,
    data: data.data,
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action) {
    // Handle custom action
    console.log('Action:', event.action);
  }

  // Navigate to URL
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (let client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
```

### Subscribe/Unsubscribe Flow (frontend code)

```typescript
// Check browser support
if ('serviceWorker' in navigator && 'PushManager' in window) {
  // Get VAPID public key
  const keyResponse = await fetch('/api/notifications/vapid-public-key');
  const { publicKey } = await keyResponse.json();

  // Register service worker
  const registration = await navigator.serviceWorker.register('/service-worker.js');

  // Subscribe to push
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  // Send subscription to backend
  await fetch('/api/notifications/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription }),
    credentials: 'include',
  });

  // Unsubscribe when needed
  async function unsubscribe() {
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        credentials: 'include',
      });
      await subscription.unsubscribe();
    }
  }
}

// Helper function
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
```

---

## Data Storage

Push subscriptions are stored in JSON format at `data/push-subscriptions.json`:

```json
{
  "base64_encoded_endpoint": {
    "id": "push_1234567890_abcdef",
    "userId": "user_123",
    "agencyId": "agency_456",
    "role": "STAFF",
    "endpoint": "https://fcm.googleapis.com/...",
    "keys": {
      "p256dh": "base64_key",
      "auth": "base64_key"
    },
    "createdAt": 1710970000000
  }
}
```

**Future Migration:** Switch to PostgreSQL/MongoDB by implementing new functions while keeping the same API.

---

## Error Handling

The service automatically handles:
- **404/410 responses** from push service: Invalid/expired subscriptions are deleted
- **Network errors**: Logged to console
- **Invalid VAPID keys**: Returns early without sending
- **Missing endpoint**: Returns 400 error from API

---

## Testing

### Test Endpoint
POST to `/api/notifications/test` while authenticated to receive a test notification.

### Manual Testing
```bash
# Authenticate first to get token
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'

# Send test notification
curl -X POST http://localhost:3001/api/notifications/test \
  -H "Authorization: Bearer <your_token>"
```

---

## Production Checklist

- [ ] Generate VAPID keys: `web-push generate-vapid-keys`
- [ ] Add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to production `.env`
- [ ] Integrate service worker in frontend app
- [ ] Add subscribe/unsubscribe flows to UI
- [ ] Test notifications in staging environment
- [ ] Plan migration from JSON to persistent database
- [ ] Set up monitoring for failed push deliveries
- [ ] Consider retry logic for failed notifications
- [ ] Add notification preference settings per user

---

## Database Migration Guide

When ready to use a real database, create new functions:

```typescript
// Example PostgreSQL implementation
export async function savePushSubscription(sub: PushSubscriptionRecord) {
  await db.query(
    `INSERT INTO push_subscriptions (id, userId, agencyId, role, endpoint, keys, createdAt)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (endpoint) DO UPDATE SET
       userId = $2, agencyId = $3, role = $4, createdAt = $7`,
    [sub.id, sub.userId, sub.agencyId, sub.role, sub.endpoint, JSON.stringify(sub.keys), sub.createdAt]
  );
}
```

Then update `db.ts` to use the new functions while keeping the same API.
