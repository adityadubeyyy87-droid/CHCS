'use strict';

const {
  computeSendAt,
  slotStart,
  buildMessage,
  REMINDER_TYPES,
} = require('../../lib/reminders');

describe('reminder scheduling math', () => {
  it('computes the slot start on the correct local day', () => {
    const start = slotStart('2026-03-10', '10:00:00');
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(2);
    expect(start.getDate()).toBe(10);
    expect(start.getHours()).toBe(10);
    expect(start.getMinutes()).toBe(0);
  });

  it('subtracts exactly 24h and 2h from the slot start', () => {
    const day = computeSendAt('2026-03-10', '10:00:00', 'REMINDER_24H');
    const two = computeSendAt('2026-03-10', '10:00:00', 'REMINDER_2H');

    expect(slotStart('2026-03-10', '10:00:00').getTime() - day.getTime()).toBe(24 * 3600 * 1000);
    expect(slotStart('2026-03-10', '10:00:00').getTime() - two.getTime()).toBe(2 * 3600 * 1000);
    expect(day.getDate()).toBe(9);
    expect(two.getDate()).toBe(10);
    expect(two.getHours()).toBe(8);
  });

  it('crosses midnight correctly for early slots', () => {
    const reminder = computeSendAt('2026-03-10', '00:30:00', 'REMINDER_24H');
    expect(reminder.getDate()).toBe(9);
    expect(reminder.getHours()).toBe(0);
    expect(reminder.getMinutes()).toBe(30);
  });

  it('rejects unknown reminder types', () => {
    expect(() => computeSendAt('2026-03-10', '10:00:00', 'REMINDER_5M')).toThrow(/Unknown reminder/);
  });

  it('describes the lead time in the message', () => {
    const base = {
      booking_id: 1,
      patient_id: 2,
      name: 'Meera',
      title: 'Brookefield Camp',
      venue: 'CMRIT Auditorium',
      start_time: '09:30:00',
      type: 'REMINDER_24H',
    };
    expect(buildMessage(base)).toContain('starts tomorrow at 09:30 AM');
    expect(buildMessage({ ...base, type: 'REMINDER_2H' })).toContain('starts in about 2 hours');
    expect(REMINDER_TYPES.REMINDER_2H.minutesBefore).toBe(120);
  });
});
