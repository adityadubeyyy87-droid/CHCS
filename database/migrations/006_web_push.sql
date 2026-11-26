-- Migration 006: free browser device alerts (Web Push / VAPID).
--
-- Adds a PUSH channel to the notification audit trail and a per-device
-- subscription table. Idempotent: safe on a fresh schema and on the hosted DB.

-- 1. Notification channel enum ----------------------------------------------
SET @chsc_push_channel = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications_log'
    AND COLUMN_NAME = 'channel'
);
SET @chsc_push_channel_sql = IF(
  @chsc_push_channel IS NULL OR LOCATE('PUSH', @chsc_push_channel) = 0,
  'ALTER TABLE notifications_log MODIFY COLUMN channel ENUM(''SMS'',''EMAIL'',''PUSH'') NOT NULL',
  'DO 1'
);
PREPARE chsc_migration_006 FROM @chsc_push_channel_sql;
EXECUTE chsc_migration_006;
DEALLOCATE PREPARE chsc_migration_006;

-- 2. Device subscriptions ---------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  endpoint    VARCHAR(2048) NOT NULL,
  p256dh      VARCHAR(255) NOT NULL,
  auth        VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- 768 utf8mb4 characters = 3072 bytes, the InnoDB single-column index limit.
  UNIQUE KEY uq_push_endpoint (endpoint(768)),
  KEY idx_push_user (user_id, id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
