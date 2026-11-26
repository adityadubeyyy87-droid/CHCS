'use strict';

/**
 * Provider interface for outbound transactional messages.
 *
 * Each provider exposes `{ name, live, send(message) }`. `send` resolves with
 * `{ ok, provider, simulated, reference? }` on success and throws on failure so
 * the delivery engine can retry with backoff. With no gateway configured the
 * sandbox provider records the attempt and resolves — the rest of the pipeline
 * (scheduling, attempts, audit) is exercised exactly as it would be in
 * production. Sandbox attempts are always flagged `simulated: true` and are
 * never presented as real provider deliveries.
 */

const nodemailer = require('nodemailer');
const { redactRecipient } = require('./security');

// Browser push is deliberately optional: a missing package or missing VAPID keys
// must downgrade to an honest sandbox, never crash the delivery pipeline.
let webPush = null;
try {
  webPush = require('web-push');
} catch {
  webPush = null;
}

function buildEmailProvider(env, { quiet = false } = {}) {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;

  if (!host || !user) {
    return {
      name: 'Email Sandbox',
      live: false,
      async send({ to }) {
        // Never print or persist raw recipients / message bodies in sandbox logs.
        if (!quiet) console.log(`[EMAIL SANDBOX] → ${redactRecipient(to)} (content omitted)`);
        return {
          ok: true,
          provider: 'Email Sandbox',
          simulated: true,
          reference: `sandbox-email-${redactRecipient(to)}`,
        };
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(env.SMTP_PORT || 587),
    secure: String(env.SMTP_SECURE || 'false') === 'true',
    auth: pass ? { user, pass } : undefined,
  });

  return {
    name: 'SMTP',
    live: true,
    async send({ to, subject, text, html, attachments = [], replyTo }) {
      const info = await transporter.sendMail({
        from: env.MAIL_FROM || 'CMRIT Community Health <no-reply@cmrit.edu>',
        to,
        subject,
        text,
        ...(html ? { html } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(replyTo ? { replyTo } : {}),
      });
      return { ok: true, provider: 'SMTP', simulated: false, reference: info.messageId };
    },
  };
}

/**
 * Fast2SMS delivery.
 *
 * Indian transactional SMS needs an approved DLT sender + template. When
 * `SMS_SENDER_ID` and `SMS_DLT_TEMPLATE_ID` are configured we use route `t`
 * (transactional) and send the template's variable values. Otherwise route `q`
 * (quick) is attempted and the gateway response decides success — we never
 * report SENT unless the provider explicitly accepted the message.
 */
function buildSmsProvider(env, { quiet = false } = {}) {
  const apiKey = env.FAST2SMS_API_KEY;

  if (!apiKey) {
    return {
      name: 'SMS Sandbox',
      live: false,
      async send({ to }) {
        if (!quiet) console.log(`[SMS SANDBOX] → ${redactRecipient(to)} (content omitted)`);
        return {
          ok: true,
          provider: 'SMS Sandbox',
          simulated: true,
          reference: `sandbox-sms-${redactRecipient(to)}`,
        };
      },
    };
  }

  const providerName = env.SMS_PROVIDER || 'Fast2SMS';
  const dltSender = String(env.SMS_SENDER_ID || '').trim();
  const dltTemplate = String(env.SMS_DLT_TEMPLATE_ID || '').trim();
  const route = String(env.SMS_ROUTE || (dltSender && dltTemplate ? 't' : 'q')).trim();

  return {
    name: providerName,
    live: true,
    async send({ to, text }) {
      const url = new URL('https://www.fast2sms.com/dev/bulkV2');
      url.searchParams.set('route', route);
      url.searchParams.set('language', 'english');
      url.searchParams.set('flash', '0');
      url.searchParams.set('numbers', to);

      if (route === 't') {
        url.searchParams.set('sender_id', dltSender);
        url.searchParams.set('template_id', dltTemplate);
        // Fast2SMS expects pipe-separated template variables. A single variable
        // carrying the whole logistics sentence is the safest generic default;
        // set SMS_TEMPLATE_VARIABLES=message to send `{message}`-style templates.
        url.searchParams.set('variables_values', text.slice(0, 480));
      } else {
        url.searchParams.set('message', text.slice(0, 480));
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: { authorization: apiKey, accept: 'application/json' },
      });

      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      const accepted =
        response.ok &&
        (body === null || body.return === true || body.status === 'success' || body.status === true);

      if (!accepted) {
        const providerMessage =
          (Array.isArray(body?.message) ? body.message.join('; ') : body?.message) ||
          `SMS gateway responded ${response.status}`;
        throw new Error(String(providerMessage).slice(0, 400));
      }

      return {
        ok: true,
        provider: providerName,
        simulated: false,
        reference: body?.request_id || body?.requestId || null,
      };
    },
  };
}

/**
 * Free browser push delivery (Web Push / VAPID).
 *
 * The browser issues one subscription per device and the push service is run by
 * the browser vendor at no per-message cost. We store only the endpoint and its
 * encryption keys. A 404/410 response means the subscription is dead and must be
 * pruned; any other failure is surfaced so the audit row becomes FAILED.
 */
function buildPushProvider(env = process.env, { quiet = false, client = webPush } = {}) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(
    env.VAPID_SUBJECT ||
      env.FRONTEND_ORIGIN?.split(',')[0] ||
      'https://chsc.app',
  ).trim();
  const live = Boolean(client && publicKey && privateKey);

  if (live) {
    try {
      client.setVapidDetails(subject, publicKey, privateKey);
    } catch (error) {
      if (!quiet) console.warn('[push provider] invalid VAPID configuration:', error.message);
      return {
        name: 'Web Push Sandbox',
        live: false,
        publicKey: null,
        async send() {
          return {
            ok: true,
            provider: 'Web Push Sandbox',
            simulated: true,
            reference: 'sandbox-push-unconfigured',
          };
        },
      };
    }
  }

  return {
    name: live ? 'Web Push' : 'Web Push Sandbox',
    live,
    publicKey: live ? publicKey : null,
    async send({ subscriptions = [], subject: title, text, url } = {}) {
      if (!live) {
        if (!quiet) console.log('[PUSH SANDBOX] no VAPID keys configured (content omitted)');
        return {
          ok: true,
          provider: 'Web Push Sandbox',
          simulated: true,
          reference: 'sandbox-push-no-devices',
          accepted: 0,
          rejected: 0,
          expired: [],
        };
      }
      if (!subscriptions.length) throw new Error('No subscribed browser device on this account.');

      const payload = JSON.stringify({
        title: String(title || 'CHSC alert').slice(0, 120),
        body: String(text || 'You have a new CHSC update.').slice(0, 480),
        url: String(url || subject).slice(0, 2048),
        tag: 'chsc-update',
      });
      const outcomes = await Promise.allSettled(
        subscriptions.map((subscription) =>
          client.sendNotification(subscription, payload, {
            TTL: 12 * 60 * 60,
            urgency: 'high',
            topic: 'chsc-update',
          }),
        ),
      );

      const expired = [];
      const failures = [];
      let accepted = 0;
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          accepted += 1;
          return;
        }
        const reason = outcome.reason || {};
        const statusCode = Number(reason.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          expired.push(subscriptions[index].endpoint);
        }
        failures.push(
          String(reason.body || reason.message || reason || 'Push service rejected the message.').slice(0, 200),
        );
      });

      if (!accepted) throw new Error(failures[0] || 'The browser push service rejected every device.');

      return {
        ok: true,
        provider: 'Web Push',
        simulated: false,
        reference: `webpush-accepted-${accepted}-${Date.now()}`,
        accepted,
        rejected: subscriptions.length - accepted,
        expired,
      };
    },
  };
}

function createProviders(env = process.env, options = {}) {
  return {
    email: buildEmailProvider(env, options),
    sms: buildSmsProvider(env, options),
    push: buildPushProvider(env, options),
  };
}

module.exports = {
  createProviders,
  buildEmailProvider,
  buildSmsProvider,
  buildPushProvider,
};
