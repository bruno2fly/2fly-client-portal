/**
 * Push Notification Service
 * Sends web push notifications with humanized, dopamine-friendly messages
 */

import webpush from 'web-push';
import { getPushSubscriptions, deletePushSubscription, getUsers } from '../db.js';

// Configure VAPID
function initVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    'mailto:2flydigitalmarketing@gmail.com',
    publicKey,
    privateKey
  );
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: { url?: string; [key: string]: any };
  actions?: { action: string; title: string }[];
}

/**
 * Send push notification to a specific user (all their subscriptions)
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!initVapid()) return;
  const subs = getPushSubscriptions();
  const userSubs = Object.values(subs).filter(s => s.userId === userId);

  for (const sub of userSubs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({
          ...payload,
          icon: payload.icon || '/icons/icon-192.png',
          badge: payload.badge || '/icons/icon-192.png',
        })
      );
    } catch (err: any) {
      // If subscription expired or invalid, remove it
      if (err.statusCode === 404 || err.statusCode === 410) {
        deletePushSubscription(sub.endpoint);
      }
      console.error(`[push] Failed to send to ${sub.userId}:`, err.message);
    }
  }
}

/**
 * Send push to all users with a specific role in an agency
 */
export async function sendPushToRole(
  agencyId: string,
  role: string | string[],
  payload: PushPayload
): Promise<void> {
  if (!initVapid()) return;
  const roles = Array.isArray(role) ? role : [role];
  const subs = getPushSubscriptions();
  const users = getUsers();

  // Find user IDs matching the role
  const targetUserIds = new Set(
    Object.values(users)
      .filter(u => u.agencyId === agencyId && roles.includes(u.role))
      .map(u => u.id)
  );

  const targetSubs = Object.values(subs).filter(s => targetUserIds.has(s.userId));

  for (const sub of targetSubs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({
          ...payload,
          icon: payload.icon || '/icons/icon-192.png',
          badge: payload.badge || '/icons/icon-192.png',
        })
      );
    } catch (err: any) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        deletePushSubscription(sub.endpoint);
      }
    }
  }
}

// ── DOPAMINE NOTIFICATION TEMPLATES ──

export const NOTIFY = {
  // Client approved content
  clientApproved: (clientName: string, postTitle: string) => ({
    title: 'Approved! ' + clientName + ' loved it 🎉',
    body: '"' + postTitle.substring(0, 40) + '" just got the green light. One less thing on your plate!',
    tag: 'approval-' + Date.now(),
    data: { url: '/agency#tab=approvals' },
    actions: [{ action: 'view', title: 'View' }],
  }),

  // Client requested changes
  clientChanges: (clientName: string, postTitle: string) => ({
    title: clientName + ' left feedback 💬',
    body: 'Quick revision needed on "' + postTitle.substring(0, 35) + '". Small tweak, big impact!',
    tag: 'changes-' + Date.now(),
    data: { url: '/agency#tab=approvals' },
    actions: [{ action: 'view', title: 'See feedback' }],
  }),

  // Designer submitted work for review
  designerSubmitted: (designerName: string, taskTitle: string, clientName: string) => ({
    title: designerName.split(' ')[0] + ' just delivered! 👀',
    body: '"' + taskTitle.substring(0, 35) + '" for ' + clientName + ' is ready for your review.',
    tag: 'submitted-' + Date.now(),
    data: { url: '/agency#view=production' },
    actions: [{ action: 'review', title: 'Review now' }],
  }),

  // New task assigned to designer
  taskAssigned: (clientName: string, taskTitle: string, deadline: string) => ({
    title: 'New mission incoming! 🎯',
    body: clientName + ' needs "' + taskTitle.substring(0, 30) + '" by ' + deadline + '. You got this!',
    tag: 'assigned-' + Date.now(),
    data: { url: '/agency#view=production' },
    actions: [{ action: 'start', title: 'Start working' }],
  }),

  // New client request
  newRequest: (clientName: string, requestType: string) => ({
    title: 'New request from ' + clientName + ' 📬',
    body: requestType.substring(0, 50) + ' — check it out and keep the momentum going!',
    tag: 'request-' + Date.now(),
    data: { url: '/agency#tab=requests' },
    actions: [{ action: 'view', title: 'View request' }],
  }),

  // Content ready for client approval
  contentReadyForClient: (agencyName: string, postTitle: string) => ({
    title: 'Fresh content ready! ✨',
    body: 'Your team just dropped "' + postTitle.substring(0, 35) + '". Take a quick look and approve!',
    tag: 'ready-' + Date.now(),
    data: { url: '/' },
    actions: [{ action: 'approve', title: 'Review now' }],
  }),

  // Post published to social media
  postPublished: (clientName: string, platform: string) => ({
    title: 'Just went live! 🚀',
    body: clientName + '\'s post is now on ' + platform + '. The world is watching!',
    tag: 'published-' + Date.now(),
    data: { url: '/agency#tab=scheduled' },
  }),

  // Task overdue reminder
  taskOverdue: (taskTitle: string, clientName: string, daysLate: number) => ({
    title: 'Heads up — ' + (daysLate === 1 ? 'due yesterday' : daysLate + ' days overdue') + ' ⏰',
    body: '"' + taskTitle.substring(0, 30) + '" for ' + clientName + '. Quick win if you knock it out today 💪',
    tag: 'overdue-' + Date.now(),
    data: { url: '/agency#view=production' },
    actions: [{ action: 'open', title: 'Open task' }],
  }),

  // Design approved by agency
  designApproved: (taskTitle: string, clientName: string) => ({
    title: 'Your work is approved! 🏆',
    body: '"' + taskTitle.substring(0, 35) + '" for ' + clientName + ' passed review. Great work!',
    tag: 'design-approved-' + Date.now(),
    data: { url: '/agency#view=production' },
  }),

  // Design needs revision
  designRevision: (taskTitle: string, clientName: string) => ({
    title: 'Quick revision needed ✏️',
    body: '"' + taskTitle.substring(0, 35) + '" for ' + clientName + ' needs a small tweak. Almost there!',
    tag: 'design-revision-' + Date.now(),
    data: { url: '/agency#view=production' },
    actions: [{ action: 'open', title: 'See notes' }],
  }),

  // Weekly summary (for cron)
  weeklySummary: (clientCount: number, postsPublished: number, pendingApprovals: number) => ({
    title: 'Your week in review 📊',
    body:
      clientCount +
      ' clients, ' +
      postsPublished +
      ' posts published' +
      (pendingApprovals > 0 ? ', ' + pendingApprovals + ' awaiting approval' : '') +
      '. Keep crushing it!',
    tag: 'weekly-' + Date.now(),
    data: { url: '/agency' },
  }),
};
