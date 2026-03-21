/* 2FlyFlow PWA — network-first service worker v5 + Push Notifications */
const CACHE = '2flyflow-v5';

const URLS = [
  '/',
  '/index.html',
  '/login.html',
  '/agency.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ── Push Notification Handler ──
self.addEventListener('push', (e) => {
  if (!e.data) return;

  let payload;
  try {
    payload = e.data.json();
  } catch {
    payload = { title: '2FlyFlow', body: e.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag || 'default',
    renotify: true,
    vibrate: [100, 50, 100],
    data: payload.data || {},
    actions: payload.actions || [],
  };

  e.waitUntil(
    self.registration.showNotification(payload.title || '2FlyFlow', options)
  );
});

// ── Notification Click Handler ──
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const url = (e.notification.data && e.notification.data.url) || '/';
  const action = e.action;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window
      for (const client of clientList) {
        if (client.url.includes('2flyflow') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window if none found
      return clients.openWindow(url);
    })
  );
});
