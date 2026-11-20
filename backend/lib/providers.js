'use strict';

/**
 * Provider interface for outbound reminders.
 *
 * Each provider exposes `{ name, live, send(message) }`. `send` resolves with
 * `{ ok, provider, simulated, reference? }` on success and throws on failure so
 * the reminder engine can retry with backoff. With no gateway configured the
 * mock provider records the message and resolves — the rest of the pipeline
 * (scheduling, attempts, audit) is exercised exactly as it would be in
 * production. Simulated deliveries are always flagged `simulated: true` and
 * never presented as real.
 */

const nodemailer = require('nodemailer');

function buildEmailProvider(env, { quiet = false } = {}) {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;

  if (!host || !user) {
    return {
      name: 'Email Sandbox',
      live: false,
      async send({ to, subject, text }) {
        if (!quiet) console.log(`[EMAIL MOCK] ${to} · ${subject}\n${text}`);
        return { ok: true, provider: 'Email Sandbox', simulated: true, reference: `mock-email-${to}` };
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(env.SMTP_PORT || 587),
    secure: String(env.SMTP_SECURE || 'false') === 'true',
    auth: { user, pass },
  });

  return {
    name: 'SMTP',
    live: true,
    async send({ to, subject, text }) {
      const info = await transporter.sendMail({
        from: env.MAIL_FROM || 'CMRIT Community Health <no-reply@cmrit.edu>',
        to,
        subject,
        text,
      });
      return { ok: true, provider: 'SMTP', simulated: false, reference: info.messageId };
    },
  };
}

function buildSmsProvider(env, { quiet = false } = {}) {
  const apiKey = env.FAST2SMS_API_KEY;

  if (!apiKey) {
    return {
      name: 'SMS Sandbox',
      live: false,
      async send({ to, text }) {
        if (!quiet) console.log(`[SMS MOCK] ${to}\n${text}`);
        return { ok: true, provider: 'SMS Sandbox', simulated: true, reference: `mock-sms-${to}` };
      },
    };
  }

  return {
    name: env.SMS_PROVIDER || 'Fast2SMS',
    live: true,
    async send({ to, text }) {
      const url = new URL('https://www.fast2sms.com/dev/bulkV2');
      url.searchParams.set('route', 'q');
      url.searchParams.set('message', text.slice(0, 480));
      url.searchParams.set('language', 'english');
      url.searchParams.set('flash', '0');
      url.searchParams.set('numbers', to);

      const response = await fetch(url, { headers: { authorization: apiKey } });
      if (!response.ok) {
        throw new Error(`SMS gateway responded ${response.status}`);
      }
      return { ok: true, provider: env.SMS_PROVIDER || 'Fast2SMS', simulated: false };
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
