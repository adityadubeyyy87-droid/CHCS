-- Migration 002: Add promotion expiry to waitlist for the 15-minute claim window.
-- Supports the smart waitlist feature: promoted bookings must be claimed within
-- 15 minutes or the seat returns to the next waiting patient.
--
-- Idempotent: database/schema.sql already ships these objects, and this
-- migration must also be safe to apply to an older database that lacks them.
-- mysql2 applies migrations with multiStatements and does not understand the
-- mysql client's DELIMITER directive, so the guards use PREPARE/EXECUTE.

SET @chsc_add_expiry = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'waitlist'
      AND COLUMN_NAME = 'promotion_expires_at'
  ),
  'DO 1',
  'ALTER TABLE waitlist ADD COLUMN promotion_expires_at TIMESTAMP NULL AFTER promoted_at'
);
PREPARE chsc_migration_002 FROM @chsc_add_expiry;
EXECUTE chsc_migration_002;
DEALLOCATE PREPARE chsc_migration_002;

SET @chsc_add_index = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'waitlist'
      AND INDEX_NAME = 'idx_wait_expires'
  ),
  'DO 1',
  'ALTER TABLE waitlist ADD INDEX idx_wait_expires (promotion_expires_at, status)'
);
PREPARE chsc_migration_002 FROM @chsc_add_index;
EXECUTE chsc_migration_002;
DEALLOCATE PREPARE chsc_migration_002;
