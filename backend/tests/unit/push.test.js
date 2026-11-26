'use strict';

/**
 * Browser push helpers and the free VAPID provider.
 *
 * No test contacts a browser push service: `sendNotification` is replaced with
 * an in-memory recorder before any "live" provider send is attempted.
 */

const crypto = require('crypto');
const webPush = require('web-push');
const {
  validPushEndpoint,
  parsePushSubscription,
  publicPushDevice,
} = require('../../lib/push');
const { buildPushProvider } = require('../../lib/providers');

function fakeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/unit-test') {
  return {
    endpoint,
    keys: {
      p256dh: crypto.randomBytes(65).toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
}

describe('browser push subscription helpers', () => {
  it('accepts only real HTTPS browser push service endpoints', () => {
    expect(validPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(validPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(validPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(validPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(validPushEndpoint('https://evil.example.com/collect')).toBe(false);
    expect(validPushEndpoint('not a url')).toBe(false);
  });

  it('validates endpoint and encryption keys without inventing defaults', () => {
    const subscription = fakeSubscription();
    expect(parsePushSubscription(subscription)).toEqual({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    });
    expect(() => parsePushSubscription({ endpoint: 'https://evil.example.com/x', keys: subscription.keys }))
      .toThrow(/supported HTTPS browser push/i);
    expect(() => parsePushSubscription({ ...subscription, keys: { p256dh: 'short', auth: 'x' } }))
      .toThrow(/base64url/i);
  });

  it('shows only the endpoint host to operators', () => {
    const device = publicPushDevice({
      id: 7,
      endpoint: 'https://fcm.googleapis.com/fcm/send/private-token',
      created_at: '2026-11-27T00:00:00.000Z',
      updated_at: '2026-11-27T00:00:00.000Z',
    });
    expect(device.endpointHost).toBe('fcm.googleapis.com');
    expect(JSON.stringify(device)).not.toContain('private-token');
  });
});

describe('Web Push provider', () => {
  it('stays in honest sandbox mode without VAPID keys', async () => {
    const provider = buildPushProvider({}, { quiet: true });
    expect(provider).toMatchObject({ name: 'Web Push Sandbox', live: false, publicKey: null });
    const result = await provider.send({
      subscriptions: [fakeSubscription()],
      subject: 'Test',
      text: 'Body',
    });
    expect(result).toMatchObject({ simulated: true, provider: 'Web Push Sandbox', accepted: 0 });
  });

  it('sends the encrypted payload and returns expired subscriptions for pruning', async () => {
    const keys = webPush.generateVAPIDKeys();
    const sent = [];
    const vapid = [];
    const client = {
      setVapidDetails: (...args) => vapid.push(args),
      sendNotification: async (subscription, payload, options) => {
        sent.push({ subscription, payload, options });
        if (subscription.endpoint.includes('dead')) {
          throw Object.assign(new Error('Subscription expired'), { statusCode: 410 });
        }
      },
    };

    const provider = buildPushProvider({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'https://chsc.example/',
    }, { quiet: true, client });
    expect(provider).toMatchObject({
      name: 'Web Push',
      live: true,
      publicKey: keys.publicKey,
    });
    expect(vapid).toEqual([['https://chsc.example/', keys.publicKey, keys.privateKey]]);

    const alive = fakeSubscription();
    const dead = fakeSubscription('https://fcm.googleapis.com/fcm/send/dead-device');
    const result = await provider.send({
      subscriptions: [alive, dead],
      subject: 'CHSC reminder',
      text: 'Gate opens at 9 AM.',
      url: 'https://chsc.example/#/notifications',
    });

    expect(result).toMatchObject({
      simulated: false,
      accepted: 1,
      rejected: 1,
    });
    expect(result.expired).toEqual([dead.endpoint]);
    expect(sent).toHaveLength(2);
    const message = JSON.parse(sent[0].payload);
    expect(message).toMatchObject({
      title: 'CHSC reminder',
      body: 'Gate opens at 9 AM.',
      url: 'https://chsc.example/#/notifications',
      tag: 'chsc-update',
    });
    expect(sent[0].options).toMatchObject({ TTL: 43200, urgency: 'high' });
    expect(JSON.stringify(result)).not.toContain(keys.privateKey);
  });
});
