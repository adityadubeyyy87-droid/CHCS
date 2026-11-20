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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chsc-test-secret';
process.env.DEMO_MODE = 'true';
