-- ============================================================================
--  001 — reminders queue + "one active booking per patient per camp"
-- ============================================================================
--  Idempotent: safe to run twice on the same database.
--  Apply with:  mysql -u root -p < database/migrations/001_reminders.sql
-- ============================================================================

USE community_health_scheduler;

-- 1. Reminder queue -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminders (
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

-- 2. Resolve any pre-existing duplicates before adding the unique constraint --
UPDATE bookings
SET status = 'CANCELLED', cancelled_at = COALESCE(cancelled_at, NOW())
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY patient_id, camp_id ORDER BY booked_at ASC, id ASC) AS rn
    FROM bookings
    WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
  ) ranked
  WHERE ranked.rn > 1
);

UPDATE slots s
SET booked_count = (
  SELECT COUNT(*) FROM bookings b
  WHERE b.slot_id = s.id AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
);

-- 3. Database-level invariant ------------------------------------------------
SET @has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'active_camp_id'
);

SET @sql = IF(
  @has_column = 0,
  'ALTER TABLE bookings
     ADD COLUMN active_camp_id BIGINT UNSIGNED GENERATED ALWAYS AS (
       CASE WHEN status IN (''CONFIRMED'',''CHECKED_IN'',''COMPLETED'') THEN camp_id END
     ) VIRTUAL,
     ADD UNIQUE KEY uq_one_active_booking_per_camp (patient_id, active_camp_id)',
  'SELECT ''uq_one_active_booking_per_camp already present'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
