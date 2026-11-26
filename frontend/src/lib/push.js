// push.js — browser-side Web Push helpers.
//
// All network calls still go through api.js. This module only owns browser APIs:
// service-worker registration, permission and the PushManager subscription.

function workerUrls() {
  const scope = new URL(import.meta.env.BASE_URL || './', document.baseURI);
  return {
    scope: scope.href,
    script: new URL('sw.js', scope).href,
  };
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function registerPushWorker() {
  if (!pushSupported()) return null;
  const { script, scope } = workerUrls();
  return navigator.serviceWorker.register(script, { scope });
}

function urlBase64ToUint8Array(base64String = '') {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function browserSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/** Enable free alerts on this browser and persist the real subscription in MySQL. */
export async function enableDeviceAlerts(api) {
  if (!pushSupported()) {
    throw new Error('This browser cannot receive Web Push alerts. Use a current Chrome, Edge, Firefox or Safari browser over HTTPS.');
  }
  const config = await api.pushConfig();
  if (!config.enabled || !config.publicKey) {
    throw new Error('Browser alerts are not configured on the backend. Nothing was enabled.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted. Allow notifications for this site in your browser settings, then try again.');
  }

  const registration = await registerPushWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });
  }
  await api.subscribePush(subscription.toJSON());
  return subscription.toJSON();
}

/** Remove this browser's local subscription after the API removes its DB row. */
export async function unsubscribeBrowserPush() {
  const subscription = await browserSubscription();
  if (subscription) await subscription.unsubscribe();
  return Boolean(subscription);
}
