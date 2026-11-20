-- Migration 002: Add promotion expiry to waitlist for the 15-minute claim window.
-- Supports the smart waitlist feature: promoted bookings must be claimed within
-- 15 minutes or the seat returns to the next waiting patient.
ALTER TABLE waitlist
  ADD COLUMN promotion_expires_at TIMESTAMP NULL AFTER promoted_at,
  ADD INDEX idx_wait_expires (promotion_expires_at, status);
