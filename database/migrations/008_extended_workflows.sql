-- Migration 008: extended patient, organizer, staff and admin workflows.
--
-- Idempotent by design: every ADD COLUMN is guarded by information_schema so
-- the migration can be replayed on both a fresh schema-production bootstrap
-- and an older Railway database with real rows. No data is dropped or rewritten.
-- Uses PREPARE/EXECUTE directly (no DELIMITER directives), which mysql2's
-- multipleStatements parser supports.

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_login_at') = 0,
  'ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL AFTER is_active',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

-- Walk-in patients may be phone-only. A synthetic @chsc.local address would be
-- a fabricated delivery target, so the column is intentionally optional.
ALTER TABLE users MODIFY COLUMN email VARCHAR(190) NULL;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'camp_type') = 0,
  'ALTER TABLE camps ADD COLUMN camp_type ENUM(''GENERAL'',''EYE'',''DENTAL'',''BLOOD_DONATION'',''MATERNAL'') NOT NULL DEFAULT ''GENERAL'' AFTER status',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'service_checklist') = 0,
  'ALTER TABLE camps ADD COLUMN service_checklist JSON NULL AFTER camp_type',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'avg_service_time_mins') = 0,
  'ALTER TABLE camps ADD COLUMN avg_service_time_mins SMALLINT UNSIGNED NOT NULL DEFAULT 12 AFTER service_checklist',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'approval_status') = 0,
  'ALTER TABLE camps ADD COLUMN approval_status ENUM(''PENDING'',''APPROVED'',''REJECTED'') NOT NULL DEFAULT ''APPROVED'' AFTER avg_service_time_mins',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'rejection_reason') = 0,
  'ALTER TABLE camps ADD COLUMN rejection_reason TEXT NULL AFTER approval_status',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'approved_by') = 0,
  'ALTER TABLE camps ADD COLUMN approved_by BIGINT UNSIGNED NULL AFTER rejection_reason',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'approved_at') = 0,
  'ALTER TABLE camps ADD COLUMN approved_at DATETIME NULL AFTER approved_by',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'avg_feedback_rating') = 0,
  'ALTER TABLE camps ADD COLUMN avg_feedback_rating DECIMAL(3,2) NULL AFTER approved_at',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'family_member_id') = 0,
  'ALTER TABLE bookings ADD COLUMN family_member_id BIGINT UNSIGNED NULL AFTER pledge_on_time',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'source') = 0,
  'ALTER TABLE bookings ADD COLUMN source ENUM(''ONLINE'',''WALKIN'') NOT NULL DEFAULT ''ONLINE'' AFTER family_member_id',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

-- Notifications gain two honest delivery types. MODIFY is safe to replay.
ALTER TABLE notifications_log MODIFY COLUMN type ENUM(
  'BOOKING_CONFIRMED','WAITLIST_JOINED','WAITLIST_PROMOTED','REMINDER_24H','REMINDER_2H',
  'CANCELLATION','RESCHEDULED','CHECK_IN','ANNOUNCEMENT','PASSWORD_RESET') NOT NULL;

-- Concurrent reminder sweeps recover stale SENDING rows before claiming due
-- work. Without an index that recovery scans and locks the whole table, which
-- can deadlock two honest workers. The index is safe to replay.
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminders'
      AND INDEX_NAME = 'idx_reminders_stale') = 0,
  'ALTER TABLE reminders ADD KEY idx_reminders_stale (status, updated_at)',
  'SELECT 1'));
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

CREATE TABLE IF NOT EXISTS family_members (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id  BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(100) NOT NULL,
  age         SMALLINT UNSIGNED NULL,
  relationship VARCHAR(50) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_family_patient (patient_id, id),
  CONSTRAINT fk_family_patient FOREIGN KEY (patient_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prescreening (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id  BIGINT UNSIGNED NOT NULL,
  age_group   VARCHAR(20) NULL,
  conditions  JSON NULL,
  mobility_needs TINYINT(1) NOT NULL DEFAULT 0,
  preferred_language VARCHAR(20) NULL,
  emergency_contact_name VARCHAR(100) NOT NULL DEFAULT '',
  emergency_contact_phone VARCHAR(20) NOT NULL DEFAULT '',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_prescreen_booking (booking_id),
  CONSTRAINT fk_prescreen_booking FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feedback (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id  BIGINT UNSIGNED NOT NULL,
  rating      TINYINT NOT NULL,
  comment     TEXT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_feedback_booking (booking_id),
  KEY idx_feedback_rating (rating),
  CONSTRAINT fk_feedback_booking FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_feedback_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS camp_checklist (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  camp_id     BIGINT UNSIGNED NOT NULL,
  item        TEXT NOT NULL,
  is_done     TINYINT(1) NOT NULL DEFAULT 0,
  done_by     BIGINT UNSIGNED NULL,
  done_at     DATETIME NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_checklist_camp (camp_id, id),
  CONSTRAINT fk_checklist_camp FOREIGN KEY (camp_id) REFERENCES camps (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_checklist_user FOREIGN KEY (done_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_records (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id  BIGINT UNSIGNED NOT NULL,
  service_name VARCHAR(100) NOT NULL,
  outcome     TEXT NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_service_booking (booking_id, id),
  CONSTRAINT fk_service_booking FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_service_user FOREIGN KEY (recorded_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visit_notes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id  BIGINT UNSIGNED NOT NULL,
  note        TEXT NOT NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notes_booking (booking_id, id),
  CONSTRAINT fk_note_booking FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_note_user FOREIGN KEY (recorded_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  type        VARCHAR(50) NOT NULL,
  message     TEXT NOT NULL,
  is_read     TINYINT(1) NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inapp_user_unread (user_id, is_read, id),
  CONSTRAINT fk_inapp_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_settings (
  id                       TINYINT UNSIGNED NOT NULL,
  organization_name        VARCHAR(120) NOT NULL DEFAULT 'CHSC Community Health Initiative',
  logo_url                 VARCHAR(500) NULL,
  contact_email            VARCHAR(190) NOT NULL DEFAULT 'contact@chsc.local',
  default_slot_duration    SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  booking_hold_minutes     SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  require_camp_approval    TINYINT(1) NOT NULL DEFAULT 0,
  supported_languages      JSON NOT NULL,
  email_provider_mode      ENUM('SANDBOX','LIVE') NOT NULL DEFAULT 'SANDBOX',
  sms_provider_mode        ENUM('SANDBOX','LIVE') NOT NULL DEFAULT 'SANDBOX',
  updated_by               BIGINT UNSIGNED NULL,
  updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_org_settings_single CHECK (id = 1),
  CONSTRAINT fk_org_settings_user FOREIGN KEY (updated_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One configuration row is required; this is not sample domain data.
INSERT IGNORE INTO org_settings (id, supported_languages) VALUES (1, JSON_ARRAY('en', 'kn'));

-- Family bookings need a FK that older installs cannot have at table creation.
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND CONSTRAINT_NAME = 'fk_bookings_family');
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE bookings ADD CONSTRAINT fk_bookings_family FOREIGN KEY (family_member_id) REFERENCES family_members (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND CONSTRAINT_NAME = 'fk_camps_approver');
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE camps ADD CONSTRAINT fk_camps_approver FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

-- Query-plan indexes for the new filters and queues. Each is guarded so the
-- migration is safe to replay on a database that already has them.
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND INDEX_NAME = 'idx_camps_type_date_status');
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_camps_type_date_status ON camps (camp_type, camp_date, status)', 'SELECT 1');
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND INDEX_NAME = 'idx_camps_approval_date');
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_camps_approval_date ON camps (approval_status, camp_date, id)', 'SELECT 1');
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND INDEX_NAME = 'idx_camps_approver');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_camps_approver ON camps (approved_by)', 'SELECT 1');
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'idx_bookings_family_member');
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_bookings_family_member ON bookings (family_member_id)', 'SELECT 1');
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback' AND INDEX_NAME = 'idx_feedback_submitted');
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_feedback_submitted ON feedback (submitted_at)', 'SELECT 1');
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_records' AND INDEX_NAME = 'idx_service_recorded_by');
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_service_recorded_by ON service_records (recorded_by, recorded_at)', 'SELECT 1');
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visit_notes' AND INDEX_NAME = 'idx_notes_recorded_by');
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_notes_recorded_by ON visit_notes (recorded_by, created_at)', 'SELECT 1');
PREPARE chsc_stmt FROM @sql; EXECUTE chsc_stmt; DEALLOCATE PREPARE chsc_stmt;
