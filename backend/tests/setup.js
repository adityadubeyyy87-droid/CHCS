'use strict';

/**
 * Runs before every test file, before that file imports the server, so the
 * pool is bound to the test database and side effects are switched off.
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.DB_TEST_NAME || 'community_health_scheduler_test';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.REMINDER_CRON = 'off';
process.env.HOLD_EXPIRY_CRON = 'off';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chsc-test-secret';

// Delivery tests must never leave the machine. Force the honest sandbox even if
// a developer's local .env carries real gateway credentials.
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.FAST2SMS_API_KEY;
// No test may send a real browser push. The VAPID provider must stay in its
// honest sandbox state even if a developer's local .env has production keys.
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
