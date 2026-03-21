# Push Notifications Setup Guide

Quick start guide for enabling push notifications in 2FlyFlow.

## Step 1: Generate VAPID Keys

```bash
# Install web-push CLI globally
npm install -g web-push

# Generate keys
web-push generate-vapid-keys
```

You'll see output like:
```
Public Key: BXXXXXXX...
Private Key: AXXXXXXX...
```

## Step 2: Add Keys to Environment

Copy the keys to your `.env` file:

```bash
VAPID_PUBLIC_KEY=BXXXXXXX...
VAPID_PRIVATE_KEY=AXXXXXXX...
```

## Step 3: Rebuild Server

```bash
cd /sessions/stoic-bold-ride/mnt/2Flyflow.com/2fly-client-portal/server
npm run build
```

## Step 4: Test the Backend

Once the server is running:

```bash
# Get VAPID public key
curl http://localhost:3001/api/notifications/vapid-public-key

# Should return:
# {"publicKey":"BXXXXXXX..."}
```

## Step 5: Frontend Integration

### Add Service Worker

Create `/public/service-worker.js` with push notification handlers:

```javascript
self.addEventListener('push', event => {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      data: data.data,
      actions: data.actions,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (let client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
```

### Add Subscribe Code

In your app's initialization code:

```typescript
async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push notifications not supported');
    return;
  }

  try {
    // Get public key from backend
    const keyRes = await fetch('/api/notifications/vapid-public-key');
    const { publicKey } = await keyRes.json();

    // Register service worker
    const registration = await navigator.serviceWorker.register('/service-worker.js');

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // Send subscription to backend
    const res = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
      credentials: 'include',
    });

    if (res.ok) {
      console.log('Push notifications enabled');
    }
  } catch (error) {
    console.error('Failed to enable push notifications:', error);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Call on app initialization
initPushNotifications();
```

## Step 6: Test the Connection

1. Start the server: `npm run dev`
2. Open the app in a browser
3. Check browser console for service worker registration
4. Should see "Push notifications enabled"
5. Make an authenticated request to `/api/notifications/test`:

```bash
# Get JWT token first (login)
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"your_username","password":"your_password"}'

# Then test notifications
curl -X POST http://localhost:3001/api/notifications/test \
  -H "Authorization: Bearer YOUR_TOKEN"
```

You should receive a browser notification!

## Step 7: Send Notifications from Code

In any route handler or service:

```typescript
import { sendPushToUser, sendPushToRole, NOTIFY } from '../lib/pushService.js';

// Notify a single user
await sendPushToUser(userId, NOTIFY.clientApproved('Acme Corp', 'Instagram Post'));

// Notify all staff in an agency
await sendPushToRole(agencyId, 'STAFF', NOTIFY.taskAssigned('Client Name', 'Task Title', 'Deadline'));

// Notify multiple roles
await sendPushToRole(agencyId, ['OWNER', 'ADMIN'], payload);
```

## API Endpoints

All endpoints require authentication (JWT token or valid session).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/notifications/vapid-public-key` | Get VAPID key for frontend |
| POST | `/api/notifications/subscribe` | Register push subscription |
| POST | `/api/notifications/unsubscribe` | Remove push subscription |
| POST | `/api/notifications/test` | Send test notification |

## Available Notification Templates

See `PUSH_NOTIFICATIONS.md` for all available templates in the `NOTIFY` object:

- `clientApproved(clientName, postTitle)`
- `clientChanges(clientName, postTitle)`
- `designerSubmitted(designerName, taskTitle, clientName)`
- `taskAssigned(clientName, taskTitle, deadline)`
- `newRequest(clientName, requestType)`
- `contentReadyForClient(agencyName, postTitle)`
- `postPublished(clientName, platform)`
- `taskOverdue(taskTitle, clientName, daysLate)`
- `designApproved(taskTitle, clientName)`
- `designRevision(taskTitle, clientName)`
- `weeklySummary(clientCount, postsPublished, pendingApprovals)`

## Troubleshooting

### "Push notifications not configured" error

Make sure `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set in `.env`.

### Service worker not registering

1. Check browser console for errors
2. Make sure `/service-worker.js` is in public root
3. Ensure service worker file has correct push event handlers

### Subscriptions not being saved

1. Verify you're authenticated (check JWT token is valid)
2. Check that `POST /api/notifications/subscribe` returns 200
3. Look at server logs for any errors

### Notifications not appearing

1. Check browser notification permissions (should be "Allow")
2. Verify service worker is active: DevTools → Application → Service Workers
3. Check browser's notification settings aren't muted
4. For Chrome: Settings → Notifications → Site notifications

## Files Modified

- `/server/src/routes/notifications.ts` - API endpoints
- `/server/src/lib/pushService.ts` - Push notification service
- `/server/src/types.ts` - Added `PushSubscriptionRecord` interface
- `/server/src/db.ts` - Added push subscription storage
- `/server/src/server.ts` - Registered notification routes

See `PUSH_NOTIFICATIONS.md` for full documentation.
