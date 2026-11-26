-- Migration 007: repair slot seat counters from the authoritative bookings.
--
-- `slots.booked_count` is a denormalised counter. An older decrement used
-- GREATEST(0, booked_count - 1), which can throw ER_DATA_OUT_OF_RANGE on an
-- unsigned zero before GREATEST is evaluated. A failed/finished release could
-- therefore leave a live HELD booking on a slot whose counter was already 0.
--
-- This migration is idempotent: it only rewrites rows whose counter differs
-- from the number of bookings that still occupy a seat. NO_SHOW counts because
-- nobody released that seat; CANCELLED and EXPIRED do not.
UPDATE slots s
LEFT JOIN (
  SELECT slot_id, COUNT(*) AS occupied
  FROM bookings
  WHERE status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW')
  GROUP BY slot_id
) b ON b.slot_id = s.id
SET s.booked_count = COALESCE(b.occupied, 0)
WHERE s.booked_count <> COALESCE(b.occupied, 0);
