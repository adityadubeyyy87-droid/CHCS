/* CHSC service worker — receives free Web Push alerts and opens the app. */
const APP_ICON = new URL('icon.svg', self.registration.scope).href;
const APP_SCOPE = self.registration.scope;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = String(data.title || 'CHSC alert').slice(0, 120);
  const body = String(data.body || 'You have a new CHSC update.').slice(0, 480);
  let target = new URL(String(data.url || APP_SCOPE), APP_SCOPE);
  if (target.origin !== self.location.origin) target = new URL(APP_SCOPE, self.location.origin);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: APP_ICON,
      badge: APP_ICON,
      tag: String(data.tag || 'chsc-update'),
      renotify: true,
      data: { url: target.href },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target = new URL(String(event.notification.data?.url || APP_SCOPE), APP_SCOPE);
  if (target.origin !== self.location.origin) target = new URL(APP_SCOPE, self.location.origin);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(APP_SCOPE)) {
          await client.focus();
          return client.navigate(target.href).catch(() => undefined);
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
