-- ============================================================================
--  COMMUNITY HEALTH SCREENING CAMP SCHEDULER (CHSC)
--  CMR Institute of Technology, Bengaluru · Department of ISE
--  MySQL 8.4+ schema — 9 InnoDB tables + deterministic Bengaluru seed data
-- ============================================================================
--  Run:
--    mysql -u root -p < database/schema.sql
-- ============================================================================

CREATE DATABASE IF NOT EXISTS community_health_scheduler
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE community_health_scheduler;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS notifications_log;
DROP TABLE IF EXISTS staff_assignments;
DROP TABLE IF EXISTS waitlist;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS slots;
DROP TABLE IF EXISTS camps;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------------------------------------------------------
-- 1. USERS
-- Only data-minimised demographic fields are collected. No medical history.
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(120) NOT NULL,
  email           VARCHAR(190) NOT NULL,
  phone           VARCHAR(20) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('PATIENT','ORGANIZER','DOCTOR','VOLUNTEER','ADMIN') NOT NULL DEFAULT 'PATIENT',
  age_group       ENUM('18-29','30-45','46-60','60+') NULL,
  preferred_language ENUM('en','kn') NOT NULL DEFAULT 'en',
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone),
  KEY idx_users_role (role),
  KEY idx_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. CAMPS
-- ----------------------------------------------------------------------------
CREATE TABLE camps (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title               VARCHAR(180) NOT NULL,
  description_en      TEXT NULL,
  description_kn      TEXT NULL,
  venue               VARCHAR(180) NOT NULL,
  address             VARCHAR(255) NOT NULL,
  city                VARCHAR(80) NOT NULL DEFAULT 'Bengaluru',
  -- Exact navigation coordinates are optional; the public API falls back to the
  -- encoded venue/address when an organizer has not supplied them.
  latitude            DECIMAL(10,7) NULL,
  longitude           DECIMAL(10,7) NULL,
  camp_date           DATE NOT NULL,
  start_time          TIME NOT NULL,
  end_time            TIME NOT NULL,
  slot_duration_mins  SMALLINT UNSIGNED NOT NULL,
  total_capacity      INT UNSIGNED NOT NULL,
  physical_capacity   INT UNSIGNED NOT NULL,
  status              ENUM('DRAFT','PUBLISHED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  created_by          BIGINT UNSIGNED NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_camps_date_status (camp_date, status),
  KEY idx_camps_venue (venue),
  CONSTRAINT fk_camps_creator FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_camps_time CHECK (end_time > start_time),
  CONSTRAINT chk_camps_duration CHECK (slot_duration_mins >= 5),
  CONSTRAINT chk_camps_capacity CHECK (total_capacity > 0 AND physical_capacity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. SLOTS
-- The row is the mutex for FOR UPDATE pessimistic booking.
-- ----------------------------------------------------------------------------
CREATE TABLE slots (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  camp_id       BIGINT UNSIGNED NOT NULL,
  slot_index    SMALLINT UNSIGNED NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  capacity      SMALLINT UNSIGNED NOT NULL,
  booked_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_slot_camp_index (camp_id, slot_index),
  KEY idx_slots_camp_time (camp_id, start_time),
  KEY idx_slots_availability (camp_id, booked_count, capacity),
  CONSTRAINT fk_slots_camp FOREIGN KEY (camp_id) REFERENCES camps (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_slots_capacity CHECK (capacity > 0),
  CONSTRAINT chk_slots_booked CHECK (booked_count <= capacity),
  CONSTRAINT chk_slots_time CHECK (end_time > start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. BOOKINGS
-- uq_slot_patient is the database-level idempotency guard against double booking.
-- ----------------------------------------------------------------------------
CREATE TABLE bookings (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slot_id         BIGINT UNSIGNED NOT NULL,
  camp_id         BIGINT UNSIGNED NOT NULL,
  patient_id      BIGINT UNSIGNED NOT NULL,
  qr_token        VARCHAR(64) NOT NULL,
  token_number    VARCHAR(20) NOT NULL,
  status          ENUM('HELD','EXPIRED','CONFIRMED','CANCELLED','CHECKED_IN','NO_SHOW','COMPLETED') NOT NULL DEFAULT 'CONFIRMED',
  -- Derived key: non-NULL only while the booking is active. HELD reservations
  -- participate so one patient cannot hold two seats at the same camp while a
  -- checkout is in flight.
  active_camp_id  BIGINT UNSIGNED GENERATED ALWAYS AS (
                    CASE WHEN status IN ('HELD','CONFIRMED','CHECKED_IN','COMPLETED') THEN camp_id END
                  ) VIRTUAL,
  travel_mode     ENUM('WALK','AUTO_BUS','TWO_WHEELER','WITH_FAMILY') NULL,
  pledge_on_time  TINYINT(1) NOT NULL DEFAULT 0,
  booked_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hold_expires_at DATETIME NULL,
  checked_in_at   TIMESTAMP NULL,
  cancelled_at    TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_slot_patient (slot_id, patient_id),
  UNIQUE KEY uq_one_active_booking_per_camp (patient_id, active_camp_id),
  UNIQUE KEY uq_bookings_qr (qr_token),
  UNIQUE KEY uq_bookings_token_number (token_number),
  KEY idx_bookings_camp_status (camp_id, status),
  KEY idx_bookings_patient (patient_id, status),
  KEY idx_bookings_hold_expiry (status, hold_expires_at),
  KEY idx_bookings_checked_in (camp_id, checked_in_at),
  CONSTRAINT fk_bookings_slot FOREIGN KEY (slot_id) REFERENCES slots (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bookings_camp FOREIGN KEY (camp_id) REFERENCES camps (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bookings_patient FOREIGN KEY (patient_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. WAITLIST
-- FIFO is enforced by created_at + id under a row lock.
-- ----------------------------------------------------------------------------
CREATE TABLE waitlist (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slot_id     BIGINT UNSIGNED NOT NULL,
  camp_id     BIGINT UNSIGNED NOT NULL,
  patient_id  BIGINT UNSIGNED NOT NULL,
  position    INT UNSIGNED NOT NULL,
  status      ENUM('WAITING','PROMOTED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'WAITING',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  promoted_at TIMESTAMP NULL,
  promotion_expires_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wait_slot_patient (slot_id, patient_id),
  KEY idx_wait_fifo (slot_id, status, created_at, id),
  KEY idx_wait_camp (camp_id, status),
  KEY idx_wait_patient (patient_id, status),
  KEY idx_wait_expires (promotion_expires_at, status),
  CONSTRAINT fk_wait_slot FOREIGN KEY (slot_id) REFERENCES slots (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_wait_camp FOREIGN KEY (camp_id) REFERENCES camps (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_wait_patient FOREIGN KEY (patient_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. STAFF ASSIGNMENTS
-- expected_load_per_hour powers the live clinical load-balancer warning.
-- ----------------------------------------------------------------------------
CREATE TABLE staff_assignments (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  camp_id               BIGINT UNSIGNED NOT NULL,
  user_id               BIGINT UNSIGNED NOT NULL,
  role_at_camp          ENUM('DOCTOR','VOLUNTEER','NURSE','COORDINATOR') NOT NULL,
  shift_start           TIME NOT NULL,
  shift_end             TIME NOT NULL,
  expected_load_per_hour SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_patients_per_hour SMALLINT UNSIGNED NOT NULL DEFAULT 20,
  duties                VARCHAR(255) NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_camp_user (camp_id, user_id),
  KEY idx_staff_user (user_id),
  KEY idx_staff_camp_role (camp_id, role_at_camp),
  CONSTRAINT fk_staff_camp FOREIGN KEY (camp_id) REFERENCES camps (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_staff_shift CHECK (shift_end > shift_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 7. NOTIFICATIONS LOG
-- This is the audit trail behind the live Gateway Interceptor Drawer.
-- ----------------------------------------------------------------------------
CREATE TABLE notifications_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id  BIGINT UNSIGNED NULL,
  user_id     BIGINT UNSIGNED NULL,
  channel     ENUM('SMS','EMAIL','PUSH') NOT NULL,
  type        ENUM('BOOKING_CONFIRMED','WAITLIST_JOINED','WAITLIST_PROMOTED','REMINDER_24H','REMINDER_2H','CANCELLATION','RESCHEDULED','CHECK_IN') NOT NULL,
  recipient   VARCHAR(190) NOT NULL,
  subject     VARCHAR(190) NULL,
  message     TEXT NOT NULL,
  provider    VARCHAR(40) NOT NULL DEFAULT 'SANDBOX',
  status      ENUM('QUEUED','SENT','SIMULATED','FAILED') NOT NULL DEFAULT 'SIMULATED',
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error  VARCHAR(500) NULL,
  provider_message_id VARCHAR(190) NULL,
  -- One row per booking/event/channel. NULL is allowed for legacy rows so the
  -- unique key never blocks historical data.
  dedupe_key  VARCHAR(190) NULL,
  payload     JSON NULL,
  sent_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notify_dedupe (dedupe_key),
  KEY idx_notify_booking_type (booking_id, type),
  KEY idx_notify_user (user_id, sent_at),
  KEY idx_notify_status (status, sent_at),
  CONSTRAINT fk_notify_booking FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_notify_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 8. BROWSER PUSH SUBSCRIPTIONS
-- Free device alerts via the Web Push protocol (VAPID). One row per browser
-- device; the endpoint is the primary identity and is never shown in full.
-- ----------------------------------------------------------------------------
CREATE TABLE push_subscriptions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  endpoint    VARCHAR(2048) NOT NULL,
  p256dh      VARCHAR(255) NOT NULL,
  auth        VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- 768 utf8mb4 characters = 3072 bytes, the InnoDB single-column index limit.
  -- Real FCM/APNs/Mozilla endpoints are far shorter; the prefix is sufficient.
  UNIQUE KEY uq_push_endpoint (endpoint(768)),
  KEY idx_push_user (user_id, id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 9. AUDIT LOG
-- Who changed which booking or camp, and when. Append-only accountability log
-- for camp-day operations and organizer/admin actions.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    BIGINT UNSIGNED NULL,
  actor_name  VARCHAR(190) NULL,
  action      VARCHAR(60) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id   BIGINT UNSIGNED NULL,
  `before`    JSON NULL,
  `after`     JSON NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_target (target_type, target_id, created_at),
  KEY idx_audit_action (action, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 8. REMINDERS
-- One row per booking/type. The row is the unit of work claimed by the sweep
-- with SELECT … FOR UPDATE SKIP LOCKED, so delivery is at-least-once and
-- idempotent: a second worker can never claim the same reminder twice.
-- ----------------------------------------------------------------------------
CREATE TABLE reminders (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id  BIGINT UNSIGNED NOT NULL,
  type        ENUM('REMINDER_24H','REMINDER_2H') NOT NULL,
  send_at     DATETIME NOT NULL,
  sent_at     DATETIME NULL,
  status      ENUM('PENDING','SENDING','SENT','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  attempts    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_error  VARCHAR(500) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reminder_booking_type (booking_id, type),
  KEY idx_reminders_due (status, send_at),
  CONSTRAINT fk_reminders_booking FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_reminders_attempts CHECK (attempts <= 50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
--  SEED DATA — Bengaluru community health camps
--  All seeded accounts use Password@123, except admin@cmrit.edu (Admin@123).
-- ============================================================================

-- bcrypt(password): Password@123
SET @patient_hash = '$2a$10$iWIw2fWT7ASORzX5aZaRa.VbWdROCy1AD7Qbm.01K2Olqj0vxP8yK';
-- bcrypt(password): Admin@123
SET @admin_hash = '$2a$10$MsnfOO2fFDZ8pVNmB50KgO3JImbbYh4zzMgE3tTwf6DzhMtkwfmZO';

INSERT INTO users
  (id, name, email, phone, password_hash, role, age_group, preferred_language)
VALUES
  (1,  'Kavya Rao',        'admin@cmrit.edu',      '9000000001', @admin_hash,   'ADMIN',     NULL,    'en'),
  (2,  'Nandini Rao',      'organizer@cmrit.edu',  '9000000002', @patient_hash, 'ORGANIZER', NULL,    'en'),
  (3,  'Dr. Ananya Rao',   'doctor@cmrit.edu',     '9000000003', @patient_hash, 'DOCTOR',    NULL,    'en'),
  (4,  'Dr. Vikram Shetty','vikram@cmrit.edu',     '9000000004', @patient_hash, 'DOCTOR',    NULL,    'kn'),
  (5,  'Arjun Kumar',      'volunteer@cmrit.edu',  '9000000005', @patient_hash, 'VOLUNTEER', NULL,    'kn'),
  (6,  'Meera Sharma',     'patient@cmrit.edu',    '9845000101', @patient_hash, 'PATIENT',   '30-45', 'en'),
  (7,  'Ramesh Gowda',     'ramesh@example.com',   '9845000102', @patient_hash, 'PATIENT',   '46-60', 'kn'),
  (8,  'Kiran Kumar',      'kiran@example.com',    '9845000103', @patient_hash, 'PATIENT',   '30-45', 'kn'),
  (9,  'Lakshmi Devi',     'lakshmi@example.com',  '9845000104', @patient_hash, 'PATIENT',   '46-60', 'kn'),
  (10, 'Farhan Ali',       'farhan@example.com',   '9845000105', @patient_hash, 'PATIENT',   '18-29', 'en'),
  (11, 'Ananya Iyer',      'ananya@example.com',   '9845000106', @patient_hash, 'PATIENT',   '18-29', 'en'),
  (12, 'Suresh Babu',      'suresh@example.com',   '9845000107', @patient_hash, 'PATIENT',   '60+',   'kn'),
  (13, 'Priya Nair',       'priya@example.com',    '9845000108', @patient_hash, 'PATIENT',   '30-45', 'en'),
  (14, 'Deepa Shetty',     'deepa@example.com',    '9845000109', @patient_hash, 'PATIENT',   '46-60', 'kn'),
  (15, 'Mohammed Irfan',   'irfan@example.com',    '9845000110', @patient_hash, 'PATIENT',   '18-29', 'en'),
  (16, 'Nisha Rao',        'nisha@example.com',    '9845000111', @patient_hash, 'PATIENT',   '30-45', 'kn'),
  (17, 'Rohit Menon',      'rohit@example.com',    '9845000112', @patient_hash, 'PATIENT',   '18-29', 'en'),
  (18, 'Sneha Kulkarni',   'sneha@example.com',    '9845000113', @patient_hash, 'PATIENT',   '30-45', 'en'),
  (19, 'Imran Pasha',      'imran@example.com',    '9845000114', @patient_hash, 'PATIENT',   '18-29', 'en'),
  (20, 'Divya Ramesh',     'divya@example.com',    '9845000115', @patient_hash, 'PATIENT',   '30-45', 'kn'),
  (21, 'Harish Gowda',     'harish@example.com',   '9845000116', @patient_hash, 'PATIENT',   '60+',   'kn');

-- Upcoming camps ---------------------------------------------------------------
INSERT INTO camps
  (id, title, description_en, description_kn, venue, address, camp_date, start_time, end_time,
   slot_duration_mins, total_capacity, physical_capacity, status, created_by)
VALUES
  (1,
   'CMRIT Brookefield Community Health Camp',
   'Free general screening, BP, sugar, BMI and vision check. Please arrive 10 minutes early.',
   'ಉಚಿತ ಸಾಮಾನ್ಯ ಆರೋಗ್ಯ ತಪಾಸಣೆ, ರಕ್ತದೊತ್ತಡ, ಸಕ್ಕರೆ, BMI ಮತ್ತು ದೃಷ್ಟಿ ಪರೀಕ್ಷೆ. ದಯವಿಟ್ಟು 10 ನಿಮಿಷ ಮುಂಚಿತವಾಗಿ ಬನ್ನಿ.',
   'CMRIT Main Auditorium',
   '132 AECS Layout, Kundalahalli, Brookefield, Bengaluru 560037',
   DATE_ADD(CURDATE(), INTERVAL 4 DAY), '08:00:00', '16:00:00',
   30, 96, 80, 'PUBLISHED', 2),
  (2,
   'Whitefield Community Hall Health Camp',
   'Community screening camp with doctor consultation and basic diagnostics.',
   'ವೈದ್ಯರ ಸಲಹೆ ಮತ್ತು ಮೂಲಭೂತ ತಪಾಸಣೆಯೊಂದಿಗೆ ಸಮುದಾಯ ಆರೋಗ್ಯ ಶಿಬಿರ.',
   'Whitefield Community Hall',
   'ITPL Main Road, Whitefield, Bengaluru 560066',
   DATE_ADD(CURDATE(), INTERVAL 7 DAY), '09:00:00', '14:00:00',
   30, 80, 70, 'PUBLISHED', 2),
  (3,
   'Indiranagar Primary Health Camp',
   'Neighbourhood preventive health camp supported by CMRIT volunteers.',
   'CMRIT ಸ್ವಯಂಸೇವಕರ ಬೆಂಬಲದೊಂದಿಗೆ ನೆರೆಹೊರೆಯ ತಡೆಗಟ್ಟುವ ಆರೋಗ್ಯ ಶಿಬಿರ.',
   'Indiranagar Primary Health Centre',
   '12th Main Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038',
   DATE_ADD(CURDATE(), INTERVAL 12 DAY), '09:00:00', '13:00:00',
   30, 64, 60, 'PUBLISHED', 2);

-- Historical camps (used by analytics and the Capacity Advisor) ---------------
INSERT INTO camps
  (id, title, description_en, description_kn, venue, address, camp_date, start_time, end_time,
   slot_duration_mins, total_capacity, physical_capacity, status, created_by)
VALUES
  (4, 'Whitefield Community Health Drive (Completed)',
   'Completed historical camp used for no-show analytics.',
   'ಮುಗಿದ ಐತಿಹಾಸಿಕ ಶಿಬಿರ — ವಿಶ್ಲೇಷಣೆಗೆ ಬಳಸಲಾಗಿದೆ.',
   'Whitefield Community Hall', 'ITPL Main Road, Whitefield, Bengaluru 560066',
   DATE_SUB(CURDATE(), INTERVAL 10 DAY), '09:00:00', '13:00:00',
   60, 50, 50, 'COMPLETED', 2),
  (5, 'Indiranagar Preventive Screening (Completed)',
   'Completed historical camp used for no-show analytics.',
   'ಮುಗಿದ ಐತಿಹಾಸಿಕ ಶಿಬಿರ — ವಿಶ್ಲೇಷಣೆಗೆ ಬಳಸಲಾಗಿದೆ.',
   'Indiranagar Primary Health Centre', '12th Main Road, Indiranagar, Bengaluru 560038',
   DATE_SUB(CURDATE(), INTERVAL 25 DAY), '09:00:00', '13:00:00',
   60, 50, 50, 'COMPLETED', 2),
  (6, 'Brookefield CMRIT Screening (Completed)',
   'Completed historical camp used for no-show analytics.',
   'ಮುಗಿದ ಐತಿಹಾಸಿಕ ಶಿಬಿರ — ವಿಶ್ಲೇಷಣೆಗೆ ಬಳಸಲಾಗಿದೆ.',
   'CMRIT Main Auditorium', '132 AECS Layout, Brookefield, Bengaluru 560037',
   DATE_SUB(CURDATE(), INTERVAL 45 DAY), '09:00:00', '13:00:00',
   60, 50, 50, 'COMPLETED', 2);

-- Deterministic 30-minute slots for Camp 1 (16 slots) ------------------------
INSERT INTO slots (id, camp_id, slot_index, start_time, end_time, capacity, booked_count) VALUES
  (1,  1, 1,  '08:00:00', '08:30:00', 6, 4),
  (2,  1, 2,  '08:30:00', '09:00:00', 6, 5),
  (3,  1, 3,  '09:00:00', '09:30:00', 6, 5),
  (4,  1, 4,  '09:30:00', '10:00:00', 6, 6),
  (5,  1, 5,  '10:00:00', '10:30:00', 6, 2),
  (6,  1, 6,  '10:30:00', '11:00:00', 6, 3),
  (7,  1, 7,  '11:00:00', '11:30:00', 6, 1),
  (8,  1, 8,  '11:30:00', '12:00:00', 6, 0),
  (9,  1, 9,  '12:00:00', '12:30:00', 6, 4),
  (10, 1, 10, '12:30:00', '13:00:00', 6, 2),
  (11, 1, 11, '13:00:00', '13:30:00', 6, 0),
  (12, 1, 12, '13:30:00', '14:00:00', 6, 0),
  (13, 1, 13, '14:00:00', '14:30:00', 6, 1),
  (14, 1, 14, '14:30:00', '15:00:00', 6, 0),
  (15, 1, 15, '15:00:00', '15:30:00', 6, 0),
  (16, 1, 16, '15:30:00', '16:00:00', 6, 0);

-- Camp 2: 09:00–14:00, 30-minute slots ----------------------------------------
INSERT INTO slots (id, camp_id, slot_index, start_time, end_time, capacity, booked_count) VALUES
  (17, 2, 1,  '09:00:00', '09:30:00', 8, 8),
  (18, 2, 2,  '09:30:00', '10:00:00', 8, 6),
  (19, 2, 3,  '10:00:00', '10:30:00', 8, 8),
  (20, 2, 4,  '10:30:00', '11:00:00', 8, 4),
  (21, 2, 5,  '11:00:00', '11:30:00', 8, 3),
  (22, 2, 6,  '11:30:00', '12:00:00', 8, 2),
  (23, 2, 7,  '12:00:00', '12:30:00', 8, 1),
  (24, 2, 8,  '12:30:00', '13:00:00', 8, 0),
  (25, 2, 9,  '13:00:00', '13:30:00', 8, 0),
  (26, 2, 10, '13:30:00', '14:00:00', 8, 0);

-- Camp 3: 09:00–13:00, 30-minute slots ----------------------------------------
INSERT INTO slots (id, camp_id, slot_index, start_time, end_time, capacity, booked_count) VALUES
  (27, 3, 1, '09:00:00', '09:30:00', 8, 7),
  (28, 3, 2, '09:30:00', '10:00:00', 8, 8),
  (29, 3, 3, '10:00:00', '10:30:00', 8, 6),
  (30, 3, 4, '10:30:00', '11:00:00', 8, 3),
  (31, 3, 5, '11:00:00', '11:30:00', 8, 2),
  (32, 3, 6, '11:30:00', '12:00:00', 8, 1),
  (33, 3, 7, '12:00:00', '12:30:00', 8, 0),
  (34, 3, 8, '12:30:00', '13:00:00', 8, 0);

-- One camp-wide reporting slot for each historical camp -----------------------
INSERT INTO slots (id, camp_id, slot_index, start_time, end_time, capacity, booked_count) VALUES
  (35, 4, 1, '09:00:00', '13:00:00', 50, 9),
  (36, 5, 1, '09:00:00', '13:00:00', 50, 9),
  (37, 6, 1, '09:00:00', '13:00:00', 50, 8);

-- Upcoming demo bookings ------------------------------------------------------
INSERT INTO bookings
  (id, slot_id, camp_id, patient_id, qr_token, token_number, status, travel_mode, pledge_on_time,
   booked_at, checked_in_at)
VALUES
  (1,  5, 1, 6,  'CHSC-BLR-104', 'A-104', 'CONFIRMED', 'WALK',        1, DATE_SUB(NOW(), INTERVAL 2 DAY), NULL),
  (2,  3, 1, 17, 'CHSC-BLR-201', 'A-201', 'CONFIRMED', 'AUTO_BUS',    1, DATE_SUB(NOW(), INTERVAL 3 DAY), NULL),
  (3,  3, 1, 18, 'CHSC-BLR-202', 'A-202', 'CONFIRMED', 'WITH_FAMILY', 1, DATE_SUB(NOW(), INTERVAL 3 DAY), NULL),
  (4,  3, 1, 19, 'CHSC-BLR-203', 'A-203', 'CONFIRMED', 'TWO_WHEELER', 1, DATE_SUB(NOW(), INTERVAL 2 DAY), NULL),
  (5,  3, 1, 20, 'CHSC-BLR-204', 'A-204', 'CONFIRMED', 'WALK',        0, DATE_SUB(NOW(), INTERVAL 2 DAY), NULL),
  (6,  3, 1, 21, 'CHSC-BLR-205', 'A-205', 'CONFIRMED', 'AUTO_BUS',    1, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL),
  (7,  4, 1, 8,  'CHSC-BLR-301', 'A-301', 'CHECKED_IN', 'WALK',       1, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 20 MINUTE)),
  (8,  4, 1, 9,  'CHSC-BLR-302', 'A-302', 'CHECKED_IN', 'AUTO_BUS',   1, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 12 MINUTE)),
  (9,  4, 1, 10, 'CHSC-BLR-303', 'A-303', 'CONFIRMED', 'WITH_FAMILY', 1, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL),
  (10, 4, 1, 11, 'CHSC-BLR-304', 'A-304', 'CONFIRMED', 'WALK',        0, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL),
  (11, 4, 1, 12, 'CHSC-BLR-305', 'A-305', 'CONFIRMED', 'TWO_WHEELER', 1, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL),
  (12, 4, 1, 13, 'CHSC-BLR-306', 'A-306', 'CONFIRMED', 'AUTO_BUS',    1, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL),
  (13, 1, 1, 7,  'CHSC-BLR-401', 'A-401', 'CONFIRMED', 'WITH_FAMILY', 1, DATE_SUB(NOW(), INTERVAL 2 DAY), NULL),
  (14, 17,2, 8,  'CHSC-BLR-501', 'B-501', 'CONFIRMED', 'WALK',        1, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL),
  (15, 17,2, 9,  'CHSC-BLR-502', 'B-502', 'CONFIRMED', 'AUTO_BUS',    1, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL),
  (16, 28,3, 10, 'CHSC-BLR-601', 'C-601', 'CONFIRMED', 'TWO_WHEELER', 1, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL);

-- FIFO waitlist on the full 09:30 slot (Camp 1) ------------------------------
INSERT INTO waitlist (id, slot_id, camp_id, patient_id, position, status, created_at) VALUES
  (1, 4, 1, 7,  1, 'WAITING', DATE_SUB(NOW(), INTERVAL 90 MINUTE)),
  (2, 4, 1, 14, 2, 'WAITING', DATE_SUB(NOW(), INTERVAL 75 MINUTE)),
  (3, 4, 1, 15, 3, 'WAITING', DATE_SUB(NOW(), INTERVAL 60 MINUTE));

-- Historical bookings: 26 total, 5 NO_SHOW => 19.23% empirical no-show rate --
INSERT INTO bookings
  (id, slot_id, camp_id, patient_id, qr_token, token_number, status, travel_mode, pledge_on_time,
   booked_at, checked_in_at)
VALUES
  (1001, 35, 4, 6,  'CHSC-HIST-1001', 'H1-001', 'CHECKED_IN', 'WALK', 1, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (1002, 35, 4, 7,  'CHSC-HIST-1002', 'H1-002', 'CHECKED_IN', 'AUTO_BUS', 1, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (1003, 35, 4, 8,  'CHSC-HIST-1003', 'H1-003', 'CHECKED_IN', 'WALK', 1, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (1004, 35, 4, 9,  'CHSC-HIST-1004', 'H1-004', 'CHECKED_IN', 'WITH_FAMILY', 1, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (1005, 35, 4, 10, 'CHSC-HIST-1005', 'H1-005', 'CHECKED_IN', 'TWO_WHEELER', 1, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (1006, 35, 4, 11, 'CHSC-HIST-1006', 'H1-006', 'CHECKED_IN', 'WALK', 1, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (1007, 35, 4, 12, 'CHSC-HIST-1007', 'H1-007', 'CHECKED_IN', 'AUTO_BUS', 1, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (1008, 35, 4, 13, 'CHSC-HIST-1008', 'H1-008', 'NO_SHOW',    'WALK', 0, DATE_SUB(NOW(), INTERVAL 20 DAY), NULL),
  (1009, 35, 4, 14, 'CHSC-HIST-1009', 'H1-009', 'NO_SHOW',    'AUTO_BUS', 0, DATE_SUB(NOW(), INTERVAL 20 DAY), NULL),
  (1010, 36, 5, 6,  'CHSC-HIST-1010', 'H2-010', 'CHECKED_IN', 'WALK', 1, DATE_SUB(NOW(), INTERVAL 35 DAY), DATE_SUB(NOW(), INTERVAL 34 DAY)),
  (1011, 36, 5, 7,  'CHSC-HIST-1011', 'H2-011', 'CHECKED_IN', 'AUTO_BUS', 1, DATE_SUB(NOW(), INTERVAL 35 DAY), DATE_SUB(NOW(), INTERVAL 34 DAY)),
  (1012, 36, 5, 8,  'CHSC-HIST-1012', 'H2-012', 'CHECKED_IN', 'TWO_WHEELER', 1, DATE_SUB(NOW(), INTERVAL 35 DAY), DATE_SUB(NOW(), INTERVAL 34 DAY)),
  (1013, 36, 5, 9,  'CHSC-HIST-1013', 'H2-013', 'CHECKED_IN', 'WITH_FAMILY', 1, DATE_SUB(NOW(), INTERVAL 35 DAY), DATE_SUB(NOW(), INTERVAL 34 DAY)),
  (1014, 36, 5, 10, 'CHSC-HIST-1014', 'H2-014', 'CHECKED_IN', 'WALK', 1, DATE_SUB(NOW(), INTERVAL 35 DAY), DATE_SUB(NOW(), INTERVAL 34 DAY)),
  (1015, 36, 5, 11, 'CHSC-HIST-1015', 'H2-015', 'CHECKED_IN', 'AUTO_BUS', 1, DATE_SUB(NOW(), INTERVAL 35 DAY), DATE_SUB(NOW(), INTERVAL 34 DAY)),
  (1016, 36, 5, 12, 'CHSC-HIST-1016', 'H2-016', 'CHECKED_IN', 'WALK', 1, DATE_SUB(NOW(), INTERVAL 35 DAY), DATE_SUB(NOW(), INTERVAL 34 DAY)),
  (1017, 36, 5, 13, 'CHSC-HIST-1017', 'H2-017', 'NO_SHOW',    'TWO_WHEELER', 0, DATE_SUB(NOW(), INTERVAL 35 DAY), NULL),
  (1018, 36, 5, 14, 'CHSC-HIST-1018', 'H2-018', 'NO_SHOW',    'AUTO_BUS', 0, DATE_SUB(NOW(), INTERVAL 35 DAY), NULL),
  (1019, 37, 6, 6,  'CHSC-HIST-1019', 'H3-019', 'CHECKED_IN', 'WALK', 1, DATE_SUB(NOW(), INTERVAL 55 DAY), DATE_SUB(NOW(), INTERVAL 54 DAY)),
  (1020, 37, 6, 7,  'CHSC-HIST-1020', 'H3-020', 'CHECKED_IN', 'AUTO_BUS', 1, DATE_SUB(NOW(), INTERVAL 55 DAY), DATE_SUB(NOW(), INTERVAL 54 DAY)),
  (1021, 37, 6, 8,  'CHSC-HIST-1021', 'H3-021', 'CHECKED_IN', 'TWO_WHEELER', 1, DATE_SUB(NOW(), INTERVAL 55 DAY), DATE_SUB(NOW(), INTERVAL 54 DAY)),
  (1022, 37, 6, 9,  'CHSC-HIST-1022', 'H3-022', 'CHECKED_IN', 'WITH_FAMILY', 1, DATE_SUB(NOW(), INTERVAL 55 DAY), DATE_SUB(NOW(), INTERVAL 54 DAY)),
  (1023, 37, 6, 10, 'CHSC-HIST-1023', 'H3-023', 'CHECKED_IN', 'WALK', 1, DATE_SUB(NOW(), INTERVAL 55 DAY), DATE_SUB(NOW(), INTERVAL 54 DAY)),
  (1024, 37, 6, 11, 'CHSC-HIST-1024', 'H3-024', 'CHECKED_IN', 'AUTO_BUS', 1, DATE_SUB(NOW(), INTERVAL 55 DAY), DATE_SUB(NOW(), INTERVAL 54 DAY)),
  (1025, 37, 6, 12, 'CHSC-HIST-1025', 'H3-025', 'CHECKED_IN', 'WALK', 1, DATE_SUB(NOW(), INTERVAL 55 DAY), DATE_SUB(NOW(), INTERVAL 54 DAY)),
  (1026, 37, 6, 13, 'CHSC-HIST-1026', 'H3-026', 'NO_SHOW',    'TWO_WHEELER', 0, DATE_SUB(NOW(), INTERVAL 55 DAY), NULL);

-- Staff assignment matrix -----------------------------------------------------
INSERT INTO staff_assignments
  (id, camp_id, user_id, role_at_camp, shift_start, shift_end, expected_load_per_hour,
   max_patients_per_hour, duties)
VALUES
  (1, 1, 3, 'DOCTOR',     '08:00:00', '16:00:00', 28, 20, 'General medicine, BP and sugar review'),
  (2, 1, 4, 'DOCTOR',     '08:00:00', '16:00:00', 14, 20, 'Vision screening and referral'),
  (3, 1, 5, 'VOLUNTEER',  '07:30:00', '16:30:00', 0,  60, 'Registration desk and queue guidance'),
  (4, 2, 3, 'DOCTOR',     '09:00:00', '14:00:00', 18, 20, 'General consultation'),
  (5, 2, 5, 'VOLUNTEER',  '08:30:00', '14:30:00', 0,  60, 'Token verification'),
  (6, 3, 4, 'DOCTOR',     '09:00:00', '13:00:00', 16, 20, 'Preventive screening'),
  (7, 3, 5, 'VOLUNTEER',  '08:30:00', '13:30:00', 0,  60, 'Patient flow'),
  (8, 5, 3, 'DOCTOR',     '09:00:00', '13:00:00', 15, 20, 'Historical camp duty'),
  (9, 6, 4, 'DOCTOR',     '09:00:00', '13:00:00', 14, 20, 'Historical camp duty');

-- Live Gateway Interceptor sample log ----------------------------------------
INSERT INTO notifications_log
  (id, booking_id, user_id, channel, type, recipient, subject, message, provider, status, sent_at)
VALUES
  (1, 1, 6, 'SMS', 'BOOKING_CONFIRMED',
   '9845000101', NULL,
   'CHSC: Meera, your Brookefield camp pass CHSC-BLR-104 is confirmed for 10:00 AM. Show the QR at the registration desk. Arrive 10 min early.',
   'Fast2SMS Sandbox', 'SIMULATED', DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (2, 1, 6, 'EMAIL', 'REMINDER_24H',
   'patient@cmrit.edu', 'Your health camp is tomorrow · CHSC-BLR-104',
   'Namaste Meera, your free community health screening at CMRIT Brookefield is tomorrow. Carry your QR pass. Reply-free helpline: 080-2852-4444.',
   'Nodemailer Sandbox', 'SIMULATED', DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (3, 1, 6, 'SMS', 'REMINDER_2H',
   '9845000101', NULL,
   'CHSC: Your camp starts in 2 hours. Slot 10:00 AM. Walk, auto or bus — whichever you chose, please arrive 10 min early. — CMRIT Community Team',
   'Fast2SMS Sandbox', 'SIMULATED', DATE_SUB(NOW(), INTERVAL 2 HOUR));

-- Keep AUTO_INCREMENT sane after explicit seed IDs ---------------------------
ALTER TABLE users AUTO_INCREMENT = 101;
ALTER TABLE camps AUTO_INCREMENT = 101;
ALTER TABLE slots AUTO_INCREMENT = 101;
ALTER TABLE bookings AUTO_INCREMENT = 2001;
ALTER TABLE waitlist AUTO_INCREMENT = 101;
ALTER TABLE staff_assignments AUTO_INCREMENT = 101;
ALTER TABLE notifications_log AUTO_INCREMENT = 101;

-- ============================================================================
--  Useful verification queries
-- ============================================================================
-- SELECT * FROM camps ORDER BY camp_date;
-- SELECT s.id, c.title, s.start_time, s.booked_count, s.capacity
--   FROM slots s JOIN camps c ON c.id = s.camp_id ORDER BY c.id, s.slot_index;
-- SELECT ROUND(100 * SUM(status='NO_SHOW') / COUNT(*), 1) AS no_show_rate
--   FROM bookings WHERE status IN ('CHECKED_IN','NO_SHOW');
