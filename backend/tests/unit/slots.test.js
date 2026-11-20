'use strict';

const { buildSlotPlan } = require('../../server');

describe('buildSlotPlan — deterministic interval partitioning', () => {
  it('splits 08:00–16:00 into 16 thirty-minute slots and allocates every seat', () => {
    const plan = buildSlotPlan('08:00', '16:00', 30, 100);

    expect(plan).toHaveLength(16);
    expect(plan[0]).toMatchObject({ slotIndex: 1, startTime: '08:00:00', endTime: '08:30:00' });
    expect(plan[15]).toMatchObject({ slotIndex: 16, startTime: '15:30:00', endTime: '16:00:00' });
    expect(plan.reduce((sum, slot) => sum + slot.capacity, 0)).toBe(100);
    // Remainder distribution: 100 / 16 = 6 r 4 → four slots get 7 seats.
    expect(plan.filter((slot) => slot.capacity === 7)).toHaveLength(4);
    expect(plan.filter((slot) => slot.capacity === 6)).toHaveLength(12);
  });

  it('keeps slot boundaries contiguous', () => {
    const plan = buildSlotPlan('09:00', '12:00', 45, 8);
    expect(plan.map((slot) => slot.startTime)).toEqual(['09:00:00', '09:45:00', '10:30:00', '11:15:00']);
    for (let i = 1; i < plan.length; i += 1) {
      expect(plan[i].startTime).toBe(plan[i - 1].endTime);
    }
  });

  it('rejects a window shorter than one slot', () => {
    expect(() => buildSlotPlan('10:00', '10:10', 30, 10)).toThrowError(/shorter than one slot/i);
  });

  it('rejects an inverted window', () => {
    expect(() => buildSlotPlan('12:00', '09:00', 30, 10)).toThrowError(/after startTime/i);
  });

  it('rejects a capacity smaller than the number of slots', () => {
    expect(() => buildSlotPlan('08:00', '12:00', 30, 3)).toThrowError(/at least the number of slots/i);
  });

  it('rejects malformed times and sub-5-minute slots', () => {
    expect(() => buildSlotPlan('8am', '12:00', 30, 10)).toThrowError(/HH:MM/i);
    expect(() => buildSlotPlan('08:00', '12:00', 2, 10)).toThrowError(/at least 5/i);
  });
});
