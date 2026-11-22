-- Migration 004: two-phase seat holds for bookings and waitlist promotions.
--
-- Adds HELD/EXPIRED booking states, a bounded `hold_expires_at` deadline, the
-- sweep indexes, and includes HELD in the generated active-booking invariant.
-- Idempotent: safe on a fresh schema (all objects already exist) and on an
-- older database that still has the five-value booking status enum.
--
-- mysql2 applies migrations with multiStatements and does not understand the
-- mysql client's DELIMITER directive, so every guard uses PREPARE/EXECUTE.

-- 1. Extend the booking state machine. Keep the original value order first so
--    upgrading an existing installation does not renumber or reinterpret rows.
SET @chsc_status_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookings'
    AND COLUMN_NAME = 'status'
);
SET @chsc_status_sql = IF(
  @chsc_status_type IS NULL OR LOCATE('HELD', @chsc_status_type) = 0,
  'ALTER TABLE bookings MODIFY COLUMN status ENUM(''HELD'',''EXPIRED'',''CONFIRMED'',''CANCELLED'',''CHECKED_IN'',''NO_SHOW'',''COMPLETED'') NOT NULL DEFAULT ''CONFIRMED''',
  'DO 1'
);
PREPARE chsc_migration_004 FROM @chsc_status_sql;
EXECUTE chsc_migration_004;
DEALLOCATE PREPARE chsc_migration_004;

-- 2. Add the hold deadline column.
SET @chsc_hold_column = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'bookings'
      AND COLUMN_NAME = 'hold_expires_at'
  ),
  1,
  0
);
SET @chsc_hold_sql = IF(
  @chsc_hold_column = 1,
  'DO 1',
  'ALTER TABLE bookings ADD COLUMN hold_expires_at DATETIME NULL AFTER booked_at'
);
PREPARE chsc_migration_004 FROM @chsc_hold_sql;
EXECUTE chsc_migration_004;
DEALLOCATE PREPARE chsc_migration_004;

-- 3. Include HELD in active_camp_id. The unique index is dropped and re-added
--    only when the generated expression actually needs changing.
SET @chsc_active_expression = (
  SELECT GENERATION_EXPRESSION
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookings'
    AND COLUMN_NAME = 'active_camp_id'
);
SET @chsc_active_index = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'bookings'
      AND INDEX_NAME = 'uq_one_active_booking_per_camp'
  ),
  1,
  0
);
SET @chsc_active_modify = 'ALTER TABLE bookings MODIFY COLUMN active_camp_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status IN (''HELD'',''CONFIRMED'',''CHECKED_IN'',''COMPLETED'') THEN camp_id END) VIRTUAL';
SET @chsc_active_sql = IF(
  @chsc_active_expression IS NOT NULL AND LOCATE('HELD', @chsc_active_expression) > 0,
  'DO 1',
  IF(
    @chsc_active_index = 1,
    CONCAT(
      'ALTER TABLE bookings DROP INDEX uq_one_active_booking_per_camp, ',
      SUBSTRING(@chsc_active_modify, CHAR_LENGTH('ALTER TABLE bookings ') + 1),
      ', ADD UNIQUE KEY uq_one_active_booking_per_camp (patient_id, active_camp_id)'
    ),
    @chsc_active_modify
  )
);
PREPARE chsc_migration_004 FROM @chsc_active_sql;
EXECUTE chsc_migration_004;
DEALLOCATE PREPARE chsc_migration_004;

-- 4. Indexes used by the idempotent expiry sweep.
SET @chsc_hold_index = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'bookings'
      AND INDEX_NAME = 'idx_bookings_hold_expiry'
  ),
  1,
  0
);
SET @chsc_hold_index_sql = IF(
  @chsc_hold_index = 1,
  'DO 1',
  'ALTER TABLE bookings ADD INDEX idx_bookings_hold_expiry (status, hold_expires_at)'
);
PREPARE chsc_migration_004 FROM @chsc_hold_index_sql;
EXECUTE chsc_migration_004;
DEALLOCATE PREPARE chsc_migration_004;

SET @chsc_wait_index = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'waitlist'
      AND INDEX_NAME = 'idx_wait_expires'
  ),
  1,
  0
);
SET @chsc_wait_index_sql = IF(
  @chsc_wait_index = 1,
  'DO 1',
  'ALTER TABLE waitlist ADD INDEX idx_wait_expires (promotion_expires_at, status)'
);
PREPARE chsc_migration_004 FROM @chsc_wait_index_sql;
EXECUTE chsc_migration_004;
DEALLOCATE PREPARE chsc_migration_004;
