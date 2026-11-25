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

function createProviders(env = process.env, options = {}) {
  return {
    email: buildEmailProvider(env, options),
    sms: buildSmsProvider(env, options),
  };
}

module.exports = { createProviders, buildEmailProvider, buildSmsProvider };
