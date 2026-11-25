-- Migration 005: Maps navigation coordinates + real notification delivery audit.
--
-- Adds optional camp latitude/longitude (address fallback remains valid), the
-- RESCHEDULED notification type, retry/error/provider-response fields, and a
-- dedupe key so a booking event can never be sent twice over the same channel.
--
-- Idempotent: every object is guarded through information_schema so the
-- migration is safe on a fresh schema and on an existing hosted database.

-- 1. Camp coordinates -------------------------------------------------------
SET @chsc_lat_column = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'latitude'
  ),
  1,
  0
);
SET @chsc_lat_sql = IF(
  @chsc_lat_column = 1,
  'DO 1',
  'ALTER TABLE camps ADD COLUMN latitude DECIMAL(10,7) NULL AFTER city'
);
PREPARE chsc_migration_005 FROM @chsc_lat_sql;
EXECUTE chsc_migration_005;
DEALLOCATE PREPARE chsc_migration_005;

SET @chsc_lng_column = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camps' AND COLUMN_NAME = 'longitude'
  ),
  1,
  0
);
SET @chsc_lng_sql = IF(
  @chsc_lng_column = 1,
  'DO 1',
  'ALTER TABLE camps ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude'
);
PREPARE chsc_migration_005 FROM @chsc_lng_sql;
EXECUTE chsc_migration_005;
DEALLOCATE PREPARE chsc_migration_005;

-- 2. Notification type enum -------------------------------------------------
SET @chsc_notify_type = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications_log'
    AND COLUMN_NAME = 'type'
);
SET @chsc_notify_type_sql = IF(
  @chsc_notify_type IS NULL OR LOCATE('RESCHEDULED', @chsc_notify_type) = 0,
  'ALTER TABLE notifications_log MODIFY COLUMN type ENUM(''BOOKING_CONFIRMED'',''WAITLIST_JOINED'',''WAITLIST_PROMOTED'',''REMINDER_24H'',''REMINDER_2H'',''CANCELLATION'',''RESCHEDULED'',''CHECK_IN'') NOT NULL',
  'DO 1'
);
PREPARE chsc_migration_005 FROM @chsc_notify_type_sql;
EXECUTE chsc_migration_005;
DEALLOCATE PREPARE chsc_migration_005;

-- 3. Delivery audit columns -------------------------------------------------
SET @chsc_attempts = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications_log' AND COLUMN_NAME = 'attempts'
  ),
  1,
  0
);
SET @chsc_attempts_sql = IF(
  @chsc_attempts = 1,
  'DO 1',
  'ALTER TABLE notifications_log ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER status'
);
PREPARE chsc_migration_005 FROM @chsc_attempts_sql;
EXECUTE chsc_migration_005;
DEALLOCATE PREPARE chsc_migration_005;

SET @chsc_last_error = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications_log' AND COLUMN_NAME = 'last_error'
  ),
  1,
  0
);
SET @chsc_last_error_sql = IF(
  @chsc_last_error = 1,
  'DO 1',
  'ALTER TABLE notifications_log ADD COLUMN last_error VARCHAR(500) NULL AFTER attempts'
);
PREPARE chsc_migration_005 FROM @chsc_last_error_sql;
EXECUTE chsc_migration_005;
DEALLOCATE PREPARE chsc_migration_005;

SET @chsc_provider_ref = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications_log' AND COLUMN_NAME = 'provider_message_id'
  ),
  1,
  0
);
SET @chsc_provider_ref_sql = IF(
  @chsc_provider_ref = 1,
  'DO 1',
  'ALTER TABLE notifications_log ADD COLUMN provider_message_id VARCHAR(190) NULL AFTER last_error'
);
PREPARE chsc_migration_005 FROM @chsc_provider_ref_sql;
EXECUTE chsc_migration_005;
DEALLOCATE PREPARE chsc_migration_005;

SET @chsc_dedupe = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications_log' AND COLUMN_NAME = 'dedupe_key'
  ),
  1,
  0
);
SET @chsc_dedupe_sql = IF(
  @chsc_dedupe = 1,
  'DO 1',
  'ALTER TABLE notifications_log ADD COLUMN dedupe_key VARCHAR(190) NULL AFTER provider_message_id'
);
PREPARE chsc_migration_005 FROM @chsc_dedupe_sql;
EXECUTE chsc_migration_005;
DEALLOCATE PREPARE chsc_migration_005;

SET @chsc_updated = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications_log' AND COLUMN_NAME = 'updated_at'
  ),
  1,
  0
);
SET @chsc_updated_sql = IF(
  @chsc_updated = 1,
  'DO 1',
  'ALTER TABLE notifications_log ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
);
PREPARE chsc_migration_005 FROM @chsc_updated_sql;
EXECUTE chsc_migration_005;
DEALLOCATE PREPARE chsc_migration_005;

SET @chsc_dedupe_index = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'notifications_log'
      AND INDEX_NAME = 'uq_notify_dedupe'
  ),
  1,
  0
);
SET @chsc_dedupe_index_sql = IF(
  @chsc_dedupe_index = 1,
  'DO 1',
  'ALTER TABLE notifications_log ADD UNIQUE KEY uq_notify_dedupe (dedupe_key)'
);
PREPARE chsc_migration_005 FROM @chsc_dedupe_index_sql;
EXECUTE chsc_migration_005;
DEALLOCATE PREPARE chsc_migration_005;
