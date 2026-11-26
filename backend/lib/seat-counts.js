'use strict';

/**
 * Slot counters are a denormalised projection of bookings that still hold a
 * seat. NO_SHOW is included because nobody released that seat; CANCELLED and
 * EXPIRED are excluded because their release path decremented the counter.
 */
const SEAT_COUNT_STATUSES = ['HELD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'];

/**
 * MySQL evaluates unsigned subtraction before GREATEST(), so
 * `GREATEST(0, booked_count - 1)` still throws ER_DATA_OUT_OF_RANGE when the
 * counter is already 0. CASE only evaluates the subtraction when it is safe.
 */
const DECREMENT_BOOKED_COUNT_SQL =
  'UPDATE slots SET booked_count = CASE WHEN booked_count > 0 THEN booked_count - 1 ELSE 0 END WHERE id = ?';

async function decrementBookedCount(conn, slotId) {
  await conn.query(DECREMENT_BOOKED_COUNT_SQL, [slotId]);
}

module.exports = { SEAT_COUNT_STATUSES, DECREMENT_BOOKED_COUNT_SQL, decrementBookedCount };
