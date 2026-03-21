/**
 * Push Notification routes
 * POST /api/notifications/subscribe — register push subscription
 * POST /api/notifications/unsubscribe — remove push subscription
 * POST /api/notifications/test — send test notification (dev only)
 * GET /api/notifications/vapid-public-key — get VAPID public key for frontend
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getPushSubscriptions, savePushSubscription, deletePushSubscription } from '../db.js';

const router = Router();

// GET /api/notifications/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push notifications not configured' });
  res.json({ publicKey: key });
});

// POST /api/notifications/subscribe
router.post('/subscribe', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'subscription object with endpoint required' });
    }

    const userId = req.userId || (req as any).auth?.userId;
    const agencyId = (req as any).auth?.agencyId || (req as any).agencyId;
    const role = (req as any).auth?.role || (req as any).user?.role || 'STAFF';

    savePushSubscription({
      id: 'push_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      userId: userId || 'unknown',
      agencyId: agencyId || '',
      role,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      createdAt: Date.now(),
    });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/notifications/unsubscribe
router.post('/unsubscribe', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    deletePushSubscription(endpoint);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/notifications/test — send a test push
router.post('/test', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { sendPushToUser } = await import('../lib/pushService.js');
    const userId = req.userId || (req as any).auth?.userId;
    if (!userId) return res.status(400).json({ error: 'No userId' });
    await sendPushToUser(userId, {
      title: 'Hey, it works! 🎉',
      body: 'Push notifications are live on 2FlyFlow. You\'re all set!',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'test',
      data: { url: '/' },
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/notifications/send-to-client — send push to all subscribers for a client
router.post('/send-to-client', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { clientId, title, body } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    // Find all push subscriptions — client users have role CLIENT
    // and their userId maps to a user with clientId matching
    const { getUsers } = await import('../db.js');
    const { sendPushToUser } = await import('../lib/pushService.js');
    const users = getUsers();
    const subs = getPushSubscriptions();

    // Find client users for this clientId
    const clientUserIds = Object.values(users)
      .filter(u => u.role === 'CLIENT' && u.clientId === clientId)
      .map(u => u.id);

    // Also send to any subscription where the userId is the clientId itself
    // (some client portal logins store clientId as userId)
    let sent = 0;
    const allSubs = Object.values(subs);

    for (const sub of allSubs) {
      const isClientUser = clientUserIds.includes(sub.userId) || sub.userId === clientId;
      if (isClientUser) {
        try {
          const webpush = await import('web-push');
          const publicKey = process.env.VAPID_PUBLIC_KEY;
          const privateKey = process.env.VAPID_PRIVATE_KEY;
          if (publicKey && privateKey) {
            webpush.default.setVapidDetails('mailto:2flydigitalmarketing@gmail.com', publicKey, privateKey);
            await webpush.default.sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys as any },
              JSON.stringify({
                title: title || 'Fresh content ready! ✨',
                body: body || 'New content is waiting for your review!',
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192.png',
                tag: 'client-' + Date.now(),
                data: { url: '/' },
              })
            );
            sent++;
          }
        } catch (err: any) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            deletePushSubscription(sub.endpoint);
          }
        }
      }
    }

    // If no client-specific subs found, try sending to all subs (for testing)
    if (sent === 0 && allSubs.length > 0) {
      // Send to ALL subscribers as fallback for testing
      for (const sub of allSubs) {
        try {
          const webpush = await import('web-push');
          const publicKey = process.env.VAPID_PUBLIC_KEY;
          const privateKey = process.env.VAPID_PRIVATE_KEY;
          if (publicKey && privateKey) {
            webpush.default.setVapidDetails('mailto:2flydigitalmarketing@gmail.com', publicKey, privateKey);
            await webpush.default.sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys as any },
              JSON.stringify({
                title: title || 'Fresh content ready! ✨',
                body: body || 'New content is waiting for your review!',
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192.png',
                tag: 'client-' + Date.now(),
                data: { url: '/' },
              })
            );
            sent++;
          }
        } catch (err: any) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            deletePushSubscription(sub.endpoint);
          }
        }
      }
    }

    res.json({ success: true, sent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
