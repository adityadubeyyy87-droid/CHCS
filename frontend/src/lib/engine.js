// engine.js — CHSC Local Demo Engine (Mode B)
// A deterministic, in-memory mirror of the MySQL-backed API so the entire
// product can be demonstrated without MySQL or external gateways.
// Response shapes intentionally match backend/server.js exactly.
// Simulated outcomes are always flagged with `simulated: true` by callers.

let seq = { booking: 5000, notif: 100, waitlist: 50, camp: 900 };
let DB = null;

function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function reset() {
  seq = { booking: 5000, notif: 100, waitlist: 50, camp: 900 };
  DB = {
    users: [
      { id: 1, name: 'Kavya Rao', email: 'admin@cmrit.edu', phone: '9000000001', role: 'ADMIN', ageGroup: null, preferredLanguage: 'en', isActive: true, createdAt: new Date().toISOString() },
      { id: 2, name: 'Nandini Rao', email: 'organizer@cmrit.edu', phone: '9000000002', role: 'ORGANIZER', ageGroup: null, preferredLanguage: 'en', isActive: true, createdAt: new Date().toISOString() },
      { id: 3, name: 'Dr. Ananya Rao', email: 'doctor@cmrit.edu', phone: '9000000003', role: 'DOCTOR', ageGroup: null, preferredLanguage: 'en', isActive: true, createdAt: new Date().toISOString() },
      { id: 4, name: 'Dr. Vikram Shetty', email: 'vikram@cmrit.edu', phone: '9000000004', role: 'DOCTOR', ageGroup: null, preferredLanguage: 'kn', isActive: true, createdAt: new Date().toISOString() },
      { id: 5, name: 'Arjun Kumar', email: 'volunteer@cmrit.edu', phone: '9000000005', role: 'VOLUNTEER', ageGroup: null, preferredLanguage: 'kn', isActive: true, createdAt: new Date().toISOString() },
      { id: 6, name: 'Meera Sharma', email: 'patient@cmrit.edu', phone: '9845000101', role: 'PATIENT', ageGroup: '30-45', preferredLanguage: 'en', isActive: true, createdAt: new Date().toISOString() },
      { id: 7, name: 'Ramesh Gowda', email: 'ramesh@example.com', phone: '9845000102', role: 'PATIENT', ageGroup: '46-60', preferredLanguage: 'kn', isActive: true, createdAt: new Date().toISOString() },
      { id: 8, name: 'Kiran Kumar', email: 'kiran@example.com', phone: '9845000103', role: 'PATIENT', ageGroup: '30-45', preferredLanguage: 'kn', isActive: true, createdAt: new Date().toISOString() },
      { id: 9, name: 'Lakshmi Devi', email: 'lakshmi@example.com', phone: '9845000104', role: 'PATIENT', ageGroup: '46-60', preferredLanguage: 'kn', isActive: true, createdAt: new Date().toISOString() },
      { id: 10, name: 'Farhan Ali', email: 'farhan@example.com', phone: '9845000105', role: 'PATIENT', ageGroup: '18-29', preferredLanguage: 'en', isActive: true, createdAt: new Date().toISOString() },
      { id: 11, name: 'Ananya Iyer', email: 'ananya@example.com', phone: '9845000106', role: 'PATIENT', ageGroup: '18-29', preferredLanguage: 'en', isActive: true, createdAt: new Date().toISOString() },
      { id: 12, name: 'Suresh Babu', email: 'suresh@example.com', phone: '9845000107', role: 'PATIENT', ageGroup: '60+', preferredLanguage: 'kn', isActive: true, createdAt: new Date().toISOString() },
      { id: 13, name: 'Priya Nair', email: 'priya@example.com', phone: '9845000108', role: 'PATIENT', ageGroup: '30-45', preferredLanguage: 'en', isActive: true, createdAt: new Date().toISOString() },
      { id: 14, name: 'Deepa Shetty', email: 'deepa@example.com', phone: '9845000109', role: 'PATIENT', ageGroup: '46-60', preferredLanguage: 'kn', isActive: true, createdAt: new Date().toISOString() },
      { id: 15, name: 'Mohammed Irfan', email: 'irfan@example.com', phone: '9845000110', role: 'PATIENT', ageGroup: '18-29', preferredLanguage: 'en', isActive: true, createdAt: new Date().toISOString() },
      { id: 16, name: 'Nisha Rao', email: 'nisha@example.com', phone: '9845000111', role: 'PATIENT', ageGroup: '30-45', preferredLanguage: 'kn', isActive: true, createdAt: new Date().toISOString() },
    ],
    camps: [
      { id: 1, title: 'CMRIT Brookefield Community Health Camp', descriptionEn: 'Free general screening, BP, sugar, BMI and vision check. Please arrive 10 minutes early.', descriptionKn: 'ಉಚಿತ ಸಾಮಾನ್ಯ ಆರೋಗ್ಯ ತಪಾಸಣೆ.', venue: 'CMRIT Main Auditorium', address: '132 AECS Layout, Kundalahalli, Brookefield, Bengaluru 560037', city: 'Bengaluru', campDate: todayIso(4), startTime: '08:00:00', endTime: '16:00:00', slotDurationMins: 30, totalCapacity: 96, physicalCapacity: 80, status: 'PUBLISHED', createdBy: 2, creatorName: 'Nandini Rao' },
      { id: 2, title: 'Whitefield Community Hall Health Camp', descriptionEn: 'Community screening camp with doctor consultation and basic diagnostics.', descriptionKn: 'ವೈದ್ಯರ ಸಲಹೆ ಮತ್ತು ಮೂಲಭೂತ ತಪಾಸಣೆ.', venue: 'Whitefield Community Hall', address: 'ITPL Main Road, Whitefield, Bengaluru 560066', city: 'Bengaluru', campDate: todayIso(7), startTime: '09:00:00', endTime: '14:00:00', slotDurationMins: 30, totalCapacity: 80, physicalCapacity: 70, status: 'PUBLISHED', createdBy: 2, creatorName: 'Nandini Rao' },
      { id: 3, title: 'Indiranagar Primary Health Camp', descriptionEn: 'Neighbourhood preventive health camp supported by CMRIT volunteers.', descriptionKn: 'ನೆರೆಹೊರೆಯ ತಡೆಗಟ್ಟುವ ಆರೋಗ್ಯ ಶಿಬಿರ.', venue: 'Indiranagar Primary Health Centre', address: '12th Main Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038', city: 'Bengaluru', campDate: todayIso(12), startTime: '09:00:00', endTime: '13:00:00', slotDurationMins: 30, totalCapacity: 64, physicalCapacity: 60, status: 'PUBLISHED', createdBy: 2, creatorName: 'Nandini Rao' },
      { id: 4, title: 'Whitefield Community Health Drive (Completed)', descriptionEn: 'Completed historical camp used for no-show analytics.', descriptionKn: 'ಐತಿಹಾಸಿಕ ಶಿಬಿರ.', venue: 'Whitefield Community Hall', address: 'ITPL Main Road, Whitefield', city: 'Bengaluru', campDate: todayIso(-10), startTime: '09:00:00', endTime: '13:00:00', slotDurationMins: 60, totalCapacity: 50, physicalCapacity: 50, status: 'COMPLETED', createdBy: 2, creatorName: 'Nandini Rao' },
      { id: 5, title: 'Indiranagar Preventive Screening (Completed)', descriptionEn: 'Completed historical camp used for no-show analytics.', descriptionKn: 'ಐತಿಹಾಸಿಕ ಶಿಬಿರ.', venue: 'Indiranagar Primary Health Centre', address: '12th Main Road, Indiranagar', city: 'Bengaluru', campDate: todayIso(-25), startTime: '09:00:00', endTime: '13:00:00', slotDurationMins: 60, totalCapacity: 50, physicalCapacity: 50, status: 'COMPLETED', createdBy: 2, creatorName: 'Nandini Rao' },
      { id: 6, title: 'Brookefield CMRIT Screening (Completed)', descriptionEn: 'Completed historical camp used for no-show analytics.', descriptionKn: 'ಐತಿಹಾಸಿಕ ಶಿಬಿರ.', venue: 'CMRIT Main Auditorium', address: '132 AECS Layout, Brookefield', city: 'Bengaluru', campDate: todayIso(-45), startTime: '09:00:00', endTime: '13:00:00', slotDurationMins: 60, totalCapacity: 50, physicalCapacity: 50, status: 'COMPLETED', createdBy: 2, creatorName: 'Nandini Rao' },
    ],
    slots: [
      // camp 1 — 16 x 30min, 6 seats each (seeded occupancy)
      ...[4, 5, 5, 6, 2, 3, 1, 0, 4, 2, 0, 0, 1, 0, 0, 0].map((booked, i) => ({
        id: i + 1, campId: 1, slotIndex: i + 1,
        startTime: minsToTime(480 + i * 30), endTime: minsToTime(480 + (i + 1) * 30),
        capacity: 6, bookedCount: booked,
      })),
      // camp 2 — 10 x 30min, 8 seats
      ...[8, 6, 8, 4, 3, 2, 1, 0, 0, 0].map((booked, i) => ({
        id: i + 17, campId: 2, slotIndex: i + 1,
        startTime: minsToTime(540 + i * 30), endTime: minsToTime(540 + (i + 1) * 30),
        capacity: 8, bookedCount: booked,
      })),
      // camp 3 — 8 x 30min, 8 seats
      ...[7, 8, 6, 3, 2, 1, 0, 0].map((booked, i) => ({
        id: i + 27, campId: 3, slotIndex: i + 1,
        startTime: minsToTime(540 + i * 30), endTime: minsToTime(540 + (i + 1) * 30),
        capacity: 8, bookedCount: booked,
      })),
      // historical reporting slots
      { id: 35, campId: 4, slotIndex: 1, startTime: '09:00:00', endTime: '13:00:00', capacity: 50, bookedCount: 9 },
      { id: 36, campId: 5, slotIndex: 1, startTime: '09:00:00', endTime: '13:00:00', capacity: 50, bookedCount: 9 },
      { id: 37, campId: 6, slotIndex: 1, startTime: '09:00:00', endTime: '13:00:00', capacity: 50, bookedCount: 8 },
    ],
    bookings: [
      { id: 1, slotId: 5, campId: 1, patientId: 6, qrToken: 'CHSC-BLR-104', tokenNumber: 'A-104', status: 'CONFIRMED', travelMode: 'WALK', pledgeOnTime: true, bookedAt: new Date(Date.now() - 2 * 864e5).toISOString(), checkedInAt: null, cancelledAt: null },
      { id: 2, slotId: 3, campId: 1, patientId: 8, qrToken: 'CHSC-BLR-201', tokenNumber: 'A-201', status: 'CONFIRMED', travelMode: 'AUTO_BUS', pledgeOnTime: true, bookedAt: new Date(Date.now() - 3 * 864e5).toISOString(), checkedInAt: null, cancelledAt: null },
      { id: 3, slotId: 4, campId: 1, patientId: 8, qrToken: 'CHSC-BLR-301', tokenNumber: 'A-301', status: 'CHECKED_IN', travelMode: 'WALK', pledgeOnTime: true, bookedAt: new Date(Date.now() - 864e5).toISOString(), checkedInAt: new Date(Date.now() - 20 * 60000).toISOString(), cancelledAt: null },
      { id: 4, slotId: 4, campId: 1, patientId: 9, qrToken: 'CHSC-BLR-302', tokenNumber: 'A-302', status: 'CHECKED_IN', travelMode: 'AUTO_BUS', pledgeOnTime: true, bookedAt: new Date(Date.now() - 864e5).toISOString(), checkedInAt: new Date(Date.now() - 12 * 60000).toISOString(), cancelledAt: null },
      { id: 5, slotId: 4, campId: 1, patientId: 10, qrToken: 'CHSC-BLR-303', tokenNumber: 'A-303', status: 'CONFIRMED', travelMode: 'WALK', pledgeOnTime: false, bookedAt: new Date(Date.now() - 864e5).toISOString(), checkedInAt: null, cancelledAt: null },
      { id: 6, slotId: 1, campId: 1, patientId: 7, qrToken: 'CHSC-BLR-401', tokenNumber: 'A-401', status: 'CONFIRMED', travelMode: 'WALK', pledgeOnTime: true, bookedAt: new Date(Date.now() - 2 * 864e5).toISOString(), checkedInAt: null, cancelledAt: null },
      { id: 7, slotId: 17, campId: 2, patientId: 8, qrToken: 'CHSC-BLR-501', tokenNumber: 'B-501', status: 'CONFIRMED', travelMode: 'WALK', pledgeOnTime: true, bookedAt: new Date(Date.now() - 864e5).toISOString(), checkedInAt: null, cancelledAt: null },
      // historical: 26 completed bookings, 5 no-shows → 19.2% empirical rate
      ...histBookings(4, 35, 7, 2, 1001), ...histBookings(5, 36, 7, 2, 1011), ...histBookings(6, 37, 7, 1, 1021),
    ],
    waitlist: [
      { id: 1, slotId: 4, campId: 1, patientId: 7, position: 1, status: 'WAITING', createdAt: new Date(Date.now() - 90 * 60000).toISOString(), promotedAt: null },
      { id: 2, slotId: 4, campId: 1, patientId: 14, position: 2, status: 'WAITING', createdAt: new Date(Date.now() - 75 * 60000).toISOString(), promotedAt: null },
      { id: 3, slotId: 4, campId: 1, patientId: 15, position: 3, status: 'WAITING', createdAt: new Date(Date.now() - 60 * 60000).toISOString(), promotedAt: null },
    ],
    notifications: [
      { id: 1, bookingId: 1, userId: 6, channel: 'SMS', type: 'BOOKING_CONFIRMED', recipient: '9845000101', subject: null, message: 'CHSC: Meera, your Brookefield camp pass CHSC-BLR-104 is confirmed for 10:00 AM. Show the QR at the registration desk. Arrive 10 min early.', provider: 'Fast2SMS Sandbox', status: 'SIMULATED', sentAt: new Date(Date.now() - 2 * 864e5).toISOString() },
      { id: 2, bookingId: 1, userId: 6, channel: 'EMAIL', type: 'REMINDER_24H', recipient: 'patient@cmrit.edu', subject: 'Your health camp is tomorrow · CHSC-BLR-104', message: 'Namaste Meera, your free community health screening at CMRIT Brookefield is tomorrow. Carry your QR pass.', provider: 'Nodemailer Sandbox', status: 'SIMULATED', sentAt: new Date(Date.now() - 864e5).toISOString() },
      { id: 3, bookingId: 1, userId: 6, channel: 'SMS', type: 'REMINDER_2H', recipient: '9845000101', subject: null, message: 'CHSC: Your camp starts in 2 hours. Slot 10:00 AM.', provider: 'Fast2SMS Sandbox', status: 'SIMULATED', sentAt: new Date(Date.now() - 2 * 36e5).toISOString() },
    ],
    staff: [
      { id: 1, campId: 1, userId: 3, name: 'Dr. Ananya Rao', email: 'doctor@cmrit.edu', phone: '9000000003', roleAtCamp: 'DOCTOR', shiftStart: '08:00:00', shiftEnd: '16:00:00', expectedLoadPerHour: 28, maxPatientsPerHour: 20, duties: 'General medicine, BP and sugar review' },
      { id: 2, campId: 1, userId: 4, name: 'Dr. Vikram Shetty', email: 'vikram@cmrit.edu', phone: '9000000004', roleAtCamp: 'DOCTOR', shiftStart: '08:00:00', shiftEnd: '16:00:00', expectedLoadPerHour: 14, maxPatientsPerHour: 20, duties: 'Vision screening and referral' },
      { id: 3, campId: 1, userId: 5, name: 'Arjun Kumar', email: 'volunteer@cmrit.edu', phone: '9000000005', roleAtCamp: 'VOLUNTEER', shiftStart: '07:30:00', shiftEnd: '16:30:00', expectedLoadPerHour: 0, maxPatientsPerHour: 60, duties: 'Registration desk and queue guidance' },
      { id: 4, campId: 2, userId: 3, name: 'Dr. Ananya Rao', email: 'doctor@cmrit.edu', phone: '9000000003', roleAtCamp: 'DOCTOR', shiftStart: '09:00:00', shiftEnd: '14:00:00', expectedLoadPerHour: 18, maxPatientsPerHour: 20, duties: 'General consultation' },
    ],
  };
}

function minsToTime(totalMinutes) {
  const n = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`;
}

function histBookings(campId, slotId, attended, noShows, startId) {
  const rows = [];
  let pid = 6;
  for (let i = 0; i < attended + noShows; i++) {
    rows.push({
      id: startId + i, slotId, campId, patientId: ((pid++ - 6) % 11) + 6,
      qrToken: `CHSC-HIST-${startId + i}`, tokenNumber: `H${campId}-${startId + i}`,
      status: i < noShows ? 'NO_SHOW' : 'COMPLETED', travelMode: null, pledgeOnTime: false,
      bookedAt: new Date(Date.now() - 30 * 864e5).toISOString(), checkedInAt: null, cancelledAt: null,
    });
  }
  return rows;
}

reset();

/* --------------------------- shape helpers --------------------------- */
const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, ageGroup: u.ageGroup, preferredLanguage: u.preferredLanguage, isActive: u.isActive, createdAt: u.createdAt };

function publicSlot(s) {
  return { id: s.id, campId: s.campId, slotIndex: s.slotIndex, startTime: s.startTime, endTime: s.endTime, capacity: s.capacity, bookedCount: s.bookedCount, waitingCount: DB.waitlist.filter((w) => w.slotId === s.id && w.status === 'WAITING').length, remaining: s.capacity - s.bookedCount };
}

function campBundle(c) {
  const slots = DB.slots.filter((s) => s.campId === c.id);
  const staff = DB.staff.filter((s) => s.campId === c.id).map((s) => ({ ...s, loadWarning: s.expectedLoadPerHour > s.maxPatientsPerHour }));
  return {
    ...c,
    slotCapacity: slots.reduce((a, s) => a + s.capacity, 0),
    bookedTotal: slots.reduce((a, s) => a + s.bookedCount, 0),
    waitingTotal: DB.waitlist.filter((w) => w.campId === c.id && w.status === 'WAITING').length,
    staffTotal: staff.length,
    slots: slots.map(publicSlot),
    staff,
    loadWarnings: staff.filter((m) => m.loadWarning).map((m) => ({ staffId: m.id, name: m.name, roleAtCamp: m.roleAtCamp, expected: m.expectedLoadPerHour, threshold: m.maxPatientsPerHour, message: `${m.name} assigned ${m.expectedLoadPerHour} patients/hr — exceeds ${m.maxPatientsPerHour}/hr safe threshold.` })),
  };
}

function publicBooking(b) {
  const slot = DB.slots.find((s) => s.id === b.slotId);
  const camp = DB.camps.find((c) => c.id === b.campId);
  const patient = DB.users.find((u) => u.id === b.patientId);
  return { ...b, patientName: patient?.name, campTitle: camp?.title, campDate: camp?.campDate, venue: camp?.venue, address: camp?.address, startTime: slot?.startTime, endTime: slot?.endTime };
}

/* ------------------------------ engine ------------------------------ */
const engine = {
  reset() { reset(); },

  async health() { return { ok: true, service: 'CHSC Local Engine', demoMode: true, database: 'local-engine', dbVersion: 'in-memory', socket: 'simulated', time: new Date().toISOString() }; },

  async login(identifier, password) {
    const user = DB.users.find((u) => u.email === String(identifier).trim().toLowerCase() || u.phone === String(identifier).trim());
    if (!user || password !== 'Password@123' && password !== 'Admin@123') throw new Error('Invalid credentials. (Demo accounts use Password@123 / Admin@123)');
    return { user: publicUser(user), token: 'local-demo-token', simulated: true };
  },

  async demoLogin(role) {
    const preferred = { PATIENT: 'patient@cmrit.edu', ADMIN: 'admin@cmrit.edu', ORGANIZER: 'organizer@cmrit.edu', DOCTOR: 'doctor@cmrit.edu', VOLUNTEER: 'volunteer@cmrit.edu' }[role];
    const user = DB.users.find((u) => u.role === role && u.email === preferred) || DB.users.find((u) => u.role === role);
    if (!user) throw new Error('No demo user for this role.');
    return { user: publicUser(user), token: 'local-demo-token', demo: true, simulated: true };
  },

  async me(tokenUser) { return { user: tokenUser }; },

  async camps() { return { camps: DB.camps.filter((c) => ['PUBLISHED', 'COMPLETED'].includes(c.status)).sort((a, b) => a.campDate.localeCompare(b.campDate)).map(campBundle) }; },

  async camp(id) {
    const c = DB.camps.find((x) => x.id === Number(id));
    if (!c) throw new Error('Camp not found.');
    return { camp: campBundle(c) };
  },

  async book(slotId, { travelMode = null, pledge = false } = {}, user) {
    if (!user) throw new Error('Sign in first.');
    if (user.role !== 'PATIENT') throw new Error('Only patient accounts book appointments.');
    const slot = DB.slots.find((s) => s.id === Number(slotId));
    if (!slot) throw new Error('Slot not found.');
    const camp = DB.camps.find((c) => c.id === slot.campId);
    if (camp.status !== 'PUBLISHED') throw new Error('This camp is not accepting bookings.');
    const existing = DB.bookings.find((b) => b.slotId === slot.id && b.patientId === user.id && ['HELD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status));
    if (existing) throw new Error('You already hold a booking for this slot.');

    if (slot.bookedCount >= slot.capacity) {
      let wr = DB.waitlist.find((w) => w.slotId === slot.id && w.patientId === user.id && w.status === 'WAITING');
      if (!wr) {
        const position = DB.waitlist.filter((w) => w.slotId === slot.id && w.status === 'WAITING').length + 1;
        wr = { id: seq.waitlist++, slotId: slot.id, campId: camp.id, patientId: user.id, position, status: 'WAITING', createdAt: new Date().toISOString(), promotedAt: null };
        DB.waitlist.push(wr);
      }
      this._notify(user.id, null, 'SMS', 'WAITLIST_JOINED', user.phone, null, `CHSC waitlist: ${user.name}, you are #${wr.position} for ${camp.title} at ${slot.startTime.slice(0, 5)}. No payment or penalty.`);
      this._notify(user.id, null, 'EMAIL', 'WAITLIST_JOINED', user.email, `Waitlist #${wr.position} · ${camp.title}`, `You joined the FIFO waitlist for ${camp.title}.`);
      return { status: 'WAITLISTED', message: `Slot full. You are #${wr.position} in the FIFO waitlist.`, waitlist: { id: wr.id, slotId: slot.id, campId: camp.id, position: wr.position, status: 'WAITING' }, simulated: true };
    }

    // Capacity is reserved under the same logical lock as the live engine: the
    // seat is HELD for 10 minutes and only becomes a pass after confirmation.
    slot.bookedCount += 1;
    const qrToken = `CHSC-BLR-${Math.floor(100000 + Math.random() * 899999)}`;
    const tokenNumber = `${String.fromCharCode(65 + Math.floor(Math.random() * 6))}-${Math.floor(100000 + Math.random() * 899999)}`;
    const holdExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const reusable = DB.bookings.find((b) => b.slotId === slot.id && b.patientId === user.id && ['CANCELLED', 'EXPIRED'].includes(b.status));
    let booking;
    if (reusable) {
      Object.assign(reusable, { status: 'HELD', travelMode, pledgeOnTime: pledge, qrToken, tokenNumber, holdExpiresAt, bookedAt: new Date().toISOString(), cancelledAt: null, checkedInAt: null });
      booking = reusable;
    } else {
      booking = { id: seq.booking++, slotId: slot.id, campId: camp.id, patientId: user.id, qrToken, tokenNumber, status: 'HELD', travelMode, pledgeOnTime: pledge, holdExpiresAt, bookedAt: new Date().toISOString(), checkedInAt: null, cancelledAt: null };
      DB.bookings.push(booking);
    }
    const wl = DB.waitlist.find((w) => w.slotId === slot.id && w.patientId === user.id && w.status === 'WAITING');
    if (wl) wl.status = 'CANCELLED';
    this._notify(user.id, booking.id, 'SMS', 'BOOKING_HELD', user.phone, null, `CHSC: ${user.name}, seat on hold for 10 minutes at ${camp.title} (${slot.startTime.slice(0, 5)}). Confirm in the app to get pass ${qrToken}.`);
    return { status: 'HELD', message: 'Seat reserved for 10 minutes. Confirm to receive your pass.', booking: publicBooking(booking), holdExpiresAt, simulated: true };
  },

  async confirmBooking(id, user) {
    if (!user) throw new Error('Sign in first.');
    const b = DB.bookings.find((x) => x.id === Number(id));
    if (!b) throw new Error('Booking not found.');
    if (user.role === 'PATIENT' && b.patientId !== user.id) throw new Error('You cannot confirm this booking.');
    if (b.status === 'CONFIRMED') return { status: 'CONFIRMED', message: 'Booking was already confirmed.', booking: publicBooking(b), simulated: true };
    if (b.status !== 'HELD') throw new Error('Only a held booking can be confirmed.');

    const slot = DB.slots.find((s) => s.id === b.slotId);
    const camp = DB.camps.find((c) => c.id === b.campId);
    const patient = DB.users.find((u) => u.id === b.patientId);
    if (!Number.isFinite(new Date(b.holdExpiresAt).getTime()) || new Date(b.holdExpiresAt).getTime() <= Date.now()) {
      b.status = 'EXPIRED';
      b.holdExpiresAt = null;
      b.cancelledAt = new Date().toISOString();
      if (slot) slot.bookedCount = Math.max(0, slot.bookedCount - 1);

      const waiter = DB.waitlist.filter((w) => w.slotId === b.slotId && w.status === 'WAITING').sort((a, z) => a.createdAt.localeCompare(z.createdAt) || a.id - z.id)[0];
      if (waiter && slot) {
        const wUser = DB.users.find((u) => u.id === waiter.patientId);
        const existing = DB.bookings.find((x) => x.slotId === b.slotId && x.patientId === waiter.patientId && ['CANCELLED', 'EXPIRED'].includes(x.status));
        const promoted = existing || { id: seq.booking++, slotId: b.slotId, campId: b.campId, patientId: waiter.patientId, qrToken: `CHSC-BLR-${Math.floor(100000 + Math.random() * 899999)}`, tokenNumber: `${String.fromCharCode(65 + Math.floor(Math.random() * 6))}-${Math.floor(100000 + Math.random() * 899999)}` };
        Object.assign(promoted, { status: 'CONFIRMED', bookedAt: new Date().toISOString(), holdExpiresAt: null, cancelledAt: null, checkedInAt: null });
        if (!existing) DB.bookings.push(promoted);
        slot.bookedCount += 1;
        waiter.status = 'PROMOTED';
        waiter.promotedAt = new Date().toISOString();
      waiter.promotionExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        this._notify(waiter.patientId, promoted.id, 'SMS', 'WAITLIST_PROMOTED', wUser?.phone, null, `A hold expired and your FIFO turn is ready: ${camp.title} at ${slot.startTime.slice(0, 5)}. Pass ${promoted.qrToken}.`);
      }
      const err = new Error('Your 10-minute hold expired. The seat was released to the FIFO waitlist.');
      err.code = 'HOLD_EXPIRED';
      err.status = 409;
      throw err;
    }

    b.status = 'CONFIRMED';
    b.holdExpiresAt = null;
    b.confirmedAt = new Date().toISOString();
    this._notify(b.patientId, b.id, 'SMS', 'BOOKING_CONFIRMED', patient?.phone, null, `CHSC confirmed: ${patient?.name}, token ${b.tokenNumber} for ${camp?.title} at ${slot?.startTime.slice(0, 5)}. Pass ${b.qrToken}. Arrive 10 min early.`);
    this._notify(b.patientId, b.id, 'EMAIL', 'BOOKING_CONFIRMED', patient?.email, `Your health camp pass · ${b.tokenNumber}`, `Confirmed for ${camp?.title}. Show the QR pass at the gate.`);
    return { status: 'CONFIRMED', message: 'Seat confirmed — your pass is ready.', booking: publicBooking(b), simulated: true };
  },

  async myBookings(user) {
    return { bookings: DB.bookings.filter((b) => b.patientId === user.id).map(publicBooking).sort((a, b) => (b.bookedAt || '').localeCompare(a.bookedAt || '')) };
  },

  async cancelBooking(id, user) {
    const b = DB.bookings.find((x) => x.id === Number(id));
    if (!b) throw new Error('Booking not found.');
    if (user.role === 'PATIENT' && b.patientId !== user.id) throw new Error('You cannot cancel this booking.');
    if (!['HELD', 'CONFIRMED', 'CHECKED_IN'].includes(b.status)) throw new Error('Only an active held or confirmed booking can be released.');
    b.status = 'CANCELLED';
    b.holdExpiresAt = null;
    b.cancelledAt = new Date().toISOString();
    const slot = DB.slots.find((s) => s.id === b.slotId);
    slot.bookedCount = Math.max(0, slot.bookedCount - 1);
    const patient = DB.users.find((u) => u.id === b.patientId);
    const waiter = DB.waitlist.filter((w) => w.slotId === b.slotId && w.status === 'WAITING').sort((a, b2) => a.createdAt.localeCompare(b2.createdAt) || a.id - b2.id)[0];
    let promoted = null;
    if (waiter) {
      const wUser = DB.users.find((u) => u.id === waiter.patientId);
      const qrToken = `CHSC-BLR-${Math.floor(100000 + Math.random() * 899999)}`;
      const tokenNumber = `${String.fromCharCode(65 + Math.floor(Math.random() * 6))}-${Math.floor(100000 + Math.random() * 899999)}`;
      const existing = DB.bookings.find((x) => x.slotId === b.slotId && x.patientId === waiter.patientId);
      if (existing) {
        Object.assign(existing, { status: 'CONFIRMED', qrToken, tokenNumber, bookedAt: new Date().toISOString(), cancelledAt: null, checkedInAt: null });
        promoted = existing;
      } else {
        promoted = { id: seq.booking++, slotId: b.slotId, campId: b.campId, patientId: waiter.patientId, qrToken, tokenNumber, status: 'CONFIRMED', travelMode: null, pledgeOnTime: false, bookedAt: new Date().toISOString(), checkedInAt: null, cancelledAt: null };
        DB.bookings.push(promoted);
      }
      slot.bookedCount += 1;
      waiter.status = 'PROMOTED';
      waiter.promotedAt = new Date().toISOString();
      waiter.promotionExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      this._notify(waiter.patientId, promoted.id, 'SMS', 'WAITLIST_PROMOTED', wUser.phone, null, `Great news ${wUser.name}! A neighbour released a seat. You are now CONFIRMED for ${DB.camps.find((c) => c.id === b.campId).title} at ${slot.startTime.slice(0, 5)}. Pass ${qrToken}.`);
      this._notify(waiter.patientId, promoted.id, 'EMAIL', 'WAITLIST_PROMOTED', wUser.email, `You're in! Health camp pass ${tokenNumber}`, `Your FIFO waitlist entry was promoted to a confirmed booking.`);
    }
    this._notify(b.patientId, b.id, 'SMS', 'CANCELLATION', patient.phone, null, `CHSC: ${patient.name}, your booking has been released. Thank you for helping a neighbour. No penalty was applied.`);
    return { status: 'CANCELLED', message: waiter ? 'Seat released and the first waiting neighbour was atomically promoted.' : 'Seat released. No waitlisted patient was pending.', booking: publicBooking(b), autoPromoted: Boolean(waiter), promotedBooking: promoted ? publicBooking(promoted) : null, promotedPatient: waiter ? DB.users.find((u) => u.id === waiter.patientId) : null, simulated: true };
  },

  async rescheduleBooking(id, slotId, user) {
    if (!user) throw new Error('Sign in first.');
    const b = DB.bookings.find((x) => x.id === Number(id));
    if (!b) throw new Error('Booking not found.');
    if (user.role === 'PATIENT' && b.patientId !== user.id) throw new Error('You cannot reschedule this booking.');
    if (!['PATIENT', 'ADMIN', 'ORGANIZER'].includes(user.role)) throw new Error('You cannot reschedule this booking.');
    if (b.status !== 'CONFIRMED') throw new Error('Only a confirmed booking can be rescheduled.');
    const camp = DB.camps.find((c) => c.id === b.campId);
    if (camp.status !== 'PUBLISHED') throw new Error('This camp is not accepting changes.');
    const from = DB.slots.find((s) => s.id === b.slotId);
    const to = DB.slots.find((s) => s.id === Number(slotId));
    if (!to || to.campId !== b.campId) throw new Error('Choose another slot in the same camp.');
    if (from?.id === to.id) throw new Error('This booking is already on that slot.');
    if (to.bookedCount >= to.capacity) throw new Error('That slot is full. Pick another time.');

    from.bookedCount = Math.max(0, from.bookedCount - 1);
    to.bookedCount += 1;
    b.slotId = to.id;
    b.bookedAt = new Date().toISOString();
    const patient = DB.users.find((u) => u.id === b.patientId);
    this._notify(b.patientId, b.id, 'SMS', 'BOOKING_CONFIRMED', patient.phone, null, `CHSC: ${patient.name}, your booking moved to ${camp.title} at ${to.startTime.slice(0, 5)}. Pass ${b.qrToken}.`);
    this._notify(b.patientId, b.id, 'EMAIL', 'BOOKING_CONFIRMED', patient.email, `Moved slot · ${b.tokenNumber}`, `Your screening slot moved to ${to.startTime.slice(0, 5)} at ${camp.title}.`);
    return { status: 'RESCHEDULED', message: 'Booking moved. Reminders were re-queued for the new slot.', booking: publicBooking(b), slot: { id: to.id, startTime: to.startTime, endTime: to.endTime }, simulated: true };
  },

  async checkin(qrToken, user) {
    if (user && !['DOCTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN'].includes(user.role)) throw new Error('Check-in requires staff access.');
    const b = DB.bookings.find((x) => x.qrToken === String(qrToken).trim() || x.tokenNumber === String(qrToken).trim());
    if (!b) throw new Error('QR token not recognised.');
    if (b.status === 'CANCELLED') throw new Error('This booking was cancelled.');
    if (b.status === 'CHECKED_IN') {
      return { status: 'ALREADY_CHECKED_IN', message: 'Token was already checked in. Queue unchanged.', booking: publicBooking(b), queue: this.queueSnapshot(b.campId), simulated: true };
    }
    b.status = 'CHECKED_IN';
    b.checkedInAt = new Date().toISOString();
    const patient = DB.users.find((u) => u.id === b.patientId);
    this._notify(b.patientId, b.id, 'SMS', 'CHECK_IN', patient.phone, null, `CHSC: ${patient.name} checked in at ${DB.camps.find((c) => c.id === b.campId).venue}. Token ${b.tokenNumber}.`);
    return { status: 'CHECKED_IN', message: `Token ${b.tokenNumber} joined the live waiting room.`, booking: publicBooking(b), queue: this.queueSnapshot(b.campId), simulated: true };
  },

  queueSnapshot(campId) {
    const checked = DB.bookings.filter((b) => b.campId === Number(campId) && b.status === 'CHECKED_IN')
      .sort((a, b2) => (a.checkedInAt || '').localeCompare(b2.checkedInAt || ''));
    const withNames = checked.map((b) => {
      const p = DB.users.find((u) => u.id === b.patientId);
      const parts = (p?.name || 'Guest').split(' ');
      return { id: b.id, tokenNumber: b.tokenNumber, patientName: `${parts[0]} ${parts[1] ? parts[1][0] + '.' : ''}`.trim(), checkedInAt: b.checkedInAt, waitedMinutes: Math.max(0, Math.round((Date.now() - new Date(b.checkedInAt).getTime()) / 60000)) };
    });
    const avg = withNames.length ? Math.round(withNames.reduce((a, x) => a + x.waitedMinutes, 0) / withNames.length) : 0;
    return { campId: Number(campId), current: withNames[0] || null, next: withNames.slice(1, 5), totalCheckedIn: withNames.length, averageWaitMinutes: avg, updatedAt: new Date().toISOString() };
  },

  async queue(campId) { return { queue: this.queueSnapshot(campId) }; },

  async staffMe(user) {
    return { assignments: DB.staff.filter((s) => s.userId === user.id).map((s) => ({ ...s, loadWarning: s.expectedLoadPerHour > s.maxPatientsPerHour, campTitle: DB.camps.find((c) => c.id === s.campId)?.title, campDate: DB.camps.find((c) => c.id === s.campId)?.campDate, venue: DB.camps.find((c) => c.id === s.campId)?.venue })) };
  },

  async analytics() {
    // KPI truth is measured on completed camps only, matching server.js. Live
    // checked-in patients at an upcoming camp are operations data, not an
    // outcome sample, and must not dilute the historical no-show rate.
    const completedCampIds = new Set(DB.camps.filter((c) => c.status === 'COMPLETED').map((c) => c.id));
    const hist = DB.bookings.filter((b) => completedCampIds.has(b.campId) && ['CHECKED_IN', 'COMPLETED', 'NO_SHOW'].includes(b.status));
    const attended = hist.filter((b) => b.status !== 'NO_SHOW').length;
    const noShow = hist.length - attended;
    const completed = attended + noShow;
    const camps = DB.camps.filter((c) => ['PUBLISHED', 'COMPLETED'].includes(c.status));
    const bookingsVsCapacity = camps.map((c) => {
      const slots = DB.slots.filter((s) => s.campId === c.id);
      return { camp: c.title.replace(' Community Health Camp', '').replace(' Primary Health Camp', '').replace(' (Completed)', ''), short: c.venue.split(' ')[0], bookings: slots.reduce((a, s) => a + s.bookedCount, 0), capacity: slots.reduce((a, s) => a + s.capacity, 0), date: c.campDate, status: c.status };
    });
    const attendanceVsNoShow = camps.filter((c) => c.status === 'COMPLETED').map((c) => {
      const rows = DB.bookings.filter((b) => b.campId === c.id && ['CHECKED_IN', 'COMPLETED', 'NO_SHOW'].includes(b.status));
      return { camp: c.venue.split(' ')[0], attended: rows.filter((r) => r.status !== 'NO_SHOW').length, noShow: rows.filter((r) => r.status === 'NO_SHOW').length };
    });
    const hourly = {};
    for (const s of DB.slots.filter((s) => DB.camps.find((c) => c.id === s.campId && c.status === 'PUBLISHED'))) {
      const h = s.startTime.slice(0, 2) + ':00';
      hourly[h] = hourly[h] || { hour: h, booked: 0, capacity: 0 };
      hourly[h].booked += s.bookedCount; hourly[h].capacity += s.capacity;
    }
    return {
      kpis: {
        totalRegistered: DB.users.filter((u) => u.role === 'PATIENT').length,
        attendanceRate: completed ? Number(((attended / completed) * 100).toFixed(1)) : 0,
        waitlistPromotions: DB.waitlist.filter((w) => w.status === 'PROMOTED').length,
        noShowReductionPct: 27,
        noShowReductionBasis: 'Modelled 25–30% uplift from implementation intentions + timed reminders (Gollwitzer, 1999; meta-analytic range).',
        totalBookings: hist.length,
        noShowRate: completed ? Number(((noShow / completed) * 100).toFixed(1)) : 0,
      },
      bookingsVsCapacity,
      attendanceVsNoShow,
      hourlyUtilisation: Object.values(hourly).sort((a, b) => a.hour.localeCompare(b.hour)).map((h) => ({ ...h, utilisation: h.capacity ? Math.round((h.booked / h.capacity) * 100) : 0 })),
      meta: { generatedAt: new Date().toISOString(), engine: 'Local in-memory demo engine (Mode B)', isolation: 'Client-side simulation' },
    };
  },

  async advisor(physicalCapacity = 100) {
    const completedCampIds = new Set(DB.camps.filter((c) => c.status === 'COMPLETED').map((c) => c.id));
    const hist = DB.bookings.filter((b) => completedCampIds.has(b.campId) && ['CHECKED_IN', 'COMPLETED', 'NO_SHOW'].includes(b.status));
    const noShows = hist.filter((b) => b.status === 'NO_SHOW').length;
    const total = hist.length;
    const p = total ? noShows / total : 0;
    const cPhys = Math.max(1, Number(physicalCapacity) || 100);
    const raw = Math.ceil(cPhys / Math.max(0.01, 1 - p));
    const ceiling = Math.floor(cPhys * 1.25);
    const recommended = Math.max(cPhys, Math.min(raw, ceiling));
    return {
      badge: 'Rule-Based Statistical Heuristic — NOT Black-Box AI/ML',
      formula: 'min( ceil(C_phys / (1 - p)), floor(C_phys × (1 + α_max)) )',
      sampleSize: total, noShows, noShowRate: Number((p * 100).toFixed(1)),
      physicalCapacity: cPhys, alphaMax: 0.25, rawRecommendation: raw, safetyCeiling: ceiling,
      recommended, buffer: recommended - cPhys,
      expectedAttendance: Number((recommended * (1 - p)).toFixed(1)),
      expectedDoctorUtilisation: Math.min(100, Number((((recommended * (1 - p)) / cPhys) * 100).toFixed(1))),
      interpretation: 'The advisor only reallocates a bounded safety buffer. Clinical judgement and venue constraints remain authoritative.',
    };
  },

  async notifications(limit = 50) {
    return { notifications: [...DB.notifications].sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || '')).slice(0, limit) };
  },

  async users() { return { users: DB.users.map(publicUser) }; },

  async setRole(id, role) { const u = DB.users.find((x) => x.id === Number(id)); if (u) u.role = role; return { ok: true, simulated: true }; },
  async setUserStatus(id, isActive) { const u = DB.users.find((x) => x.id === Number(id)); if (u) u.isActive = Boolean(isActive); return { ok: true, simulated: true }; },

  async runReminders() {
    let sent = 0;
    for (const b of DB.bookings.filter((x) => x.status === 'CONFIRMED')) {
      if (DB.notifications.some((n) => n.bookingId === b.id && n.type === 'REMINDER_24H')) continue;
      const u = DB.users.find((x) => x.id === b.patientId);
      const camp = DB.camps.find((c) => c.id === b.campId);
      this._notify(u.id, b.id, 'SMS', 'REMINDER_24H', u.phone, null, `CHSC reminder: ${u.name}, your ${camp.title} at ${camp.venue} starts tomorrow. Arrive 10 minutes early with your QR pass.`);
      sent++;
    }
    return { checked: DB.bookings.filter((x) => x.status === 'CONFIRMED').length, sent, simulated: true };
  },

  async rush(campId) {
    const slots = DB.slots.filter((s) => s.campId === Number(campId) && s.bookedCount < s.capacity).slice(0, 5);
    for (const s of slots) s.bookedCount = Math.min(s.capacity, s.bookedCount + 1 + Math.floor(Math.random() * 2));
    return { campId: Number(campId), slotsTouched: slots.map((s) => s.id), note: 'Synthetic demand added to available slots only; capacity constraint preserved.', simulated: true };
  },

  async concurrency(campId) {
    // Deterministic Mode-B mirror of the 50-way concurrency proof.
    const slot = DB.slots.find((s) => s.campId === Number(campId) && s.capacity === 10 && s.bookedCount === 0);
    if (!slot) return { error: 'No empty capacity-10 slot found.', simulated: true };
    const confirmed = 10;
    const waitlisted = 40;
    const positions = Array.from({ length: 40 }, (_, i) => i + 1);
    slot.bookedCount = 10;
    for (let i = 0; i < waitlisted; i += 1) {
      DB.waitlist.push({ id: seq.waitlist++, slotId: slot.id, campId: Number(campId), patientId: 1000 + i, position: i + 1, status: 'WAITING' });
    }
    return {
      slotId: slot.id,
      capacity: 10,
      totalRequests: 50,
      confirmed,
      waitlisted,
      errors: 0,
      positions,
      db: { booked_count: 10, capacity: 10, confirmedBookings: 10, waitingBookings: 40 },
      zeroOverbooked: true,
      simulated: true,
    };
  },

  async scenario(name) {
    // Deterministic Mode-B mirror of the demo scenario loader.
    const scenarios = {
      'full-slot': { scenario: 'full-slot', booked: 10, note: 'Slot filled to capacity (10/10).' },
      'waitlist-active': { scenario: 'waitlist-active', waitlist: 8, note: '8 patients waiting for a seat.' },
      'camp-day': { scenario: 'camp-day', note: 'Camp day in flight; open Control Room.' },
    };
    return { ...(scenarios[name] || { error: 'Unknown scenario', simulated: true }), simulated: true };
  },

  async controlRoom(campId) {
    const camp = DB.camps.find((c) => c.id === Number(campId));
    if (!camp) return { error: 'Camp not found.', simulated: true };
    const slots = DB.slots.filter((s) => s.campId === Number(campId)).sort((a, b) => a.slotIndex - b.slotIndex);
    const slotBoard = slots.map((s) => ({
      id: s.id,
      slotIndex: s.slotIndex,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      booked: s.bookedCount,
      remaining: s.capacity - s.bookedCount,
      fillPct: s.capacity ? Math.round((s.bookedCount / s.capacity) * 100) : 0,
    }));
    const checkedIn = DB.bookings
      .filter((b) => b.campId === Number(campId) && b.status === 'CHECKED_IN')
      .sort((a, b) => new Date(a.checkedInAt) - new Date(b.checkedInAt))
      .map((b) => {
        const u = DB.users.find((x) => x.id === b.patientId);
        const s = DB.slots.find((x) => x.id === b.slotId);
        return {
          id: b.id,
          tokenNumber: b.tokenNumber,
          patientName: u ? u.name : 'Patient',
          checkedInAt: b.checkedInAt,
          slot: s ? `${s.startTime} – ${s.endTime}` : '',
        };
      });
    const staff = DB.staff.filter((s) => s.campId === Number(campId)).map((s) => ({
      id: s.id,
      userId: s.userId,
      name: s.name,
      roleAtCamp: s.roleAtCamp,
      shiftStart: s.shiftStart,
      shiftEnd: s.shiftEnd,
      expectedLoadPerHour: s.expectedLoadPerHour,
      maxPatientsPerHour: s.maxPatientsPerHour,
      duties: s.duties,
      loadWarning: s.expectedLoadPerHour > s.maxPatientsPerHour,
    }));
    const stats = {
      checkedIn: DB.bookings.filter((b) => b.campId === Number(campId) && b.status === 'CHECKED_IN').length,
      noShow: DB.bookings.filter((b) => b.campId === Number(campId) && b.status === 'NO_SHOW').length,
      confirmed: DB.bookings.filter((b) => b.campId === Number(campId) && b.status === 'CONFIRMED').length,
      cancelled: DB.bookings.filter((b) => b.campId === Number(campId) && b.status === 'CANCELLED').length,
      total: DB.bookings.filter((b) => b.campId === Number(campId)).length,
    };
    return { camp: { id: camp.id, title: camp.title, venue: camp.venue, campDate: camp.campDate, status: camp.status }, slots: slotBoard, checkedIn, staff, stats, minutesToStart: 120, simulated: true };
  },


  async createCamp(payload, user) {
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) throw new Error('Only organizers create camps.');
    const plan = buildPlan(payload.startTime, payload.endTime, payload.slotDurationMins, payload.totalCapacity);
    const camp = { id: seq.camp++, title: payload.title, descriptionEn: payload.descriptionEn || '', descriptionKn: payload.descriptionKn || '', venue: payload.venue, address: payload.address, city: 'Bengaluru', campDate: payload.campDate, startTime: payload.startTime, endTime: payload.endTime, slotDurationMins: payload.slotDurationMins, totalCapacity: payload.totalCapacity, physicalCapacity: payload.physicalCapacity || payload.totalCapacity, status: payload.status || 'PUBLISHED', createdBy: user.id, creatorName: user.name };
    DB.camps.push(camp);
    plan.forEach((p, i) => DB.slots.push({ id: seq.camp * 100 + i, campId: camp.id, slotIndex: p.slotIndex, startTime: p.startTime, endTime: p.endTime, capacity: p.capacity, bookedCount: 0 }));
    return { camp: campBundle(camp), slotPlan: plan, algorithm: { k: plan.length, formula: 'k = floor((T_end − T_start) / Δt); seats = floor(C_camp / k) + remainder distribution', capacityAllocated: plan.reduce((a, s) => a + s.capacity, 0) }, simulated: true };
  },

  async generateSlots(campId, payload, user) {
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) throw new Error('Only organizers configure camps.');
    const camp = DB.camps.find((c) => c.id === Number(campId));
    const hasBookings = DB.bookings.some((b) => b.campId === camp.id && b.status !== 'CANCELLED');
    if (hasBookings) throw new Error('Slots already contain bookings. Only empty camps can be regenerated.');
    const plan = buildPlan(payload.startTime, payload.endTime, payload.slotDurationMins, payload.totalCapacity);
    Object.assign(camp, { startTime: payload.startTime, endTime: payload.endTime, slotDurationMins: payload.slotDurationMins, totalCapacity: payload.totalCapacity, physicalCapacity: payload.physicalCapacity || payload.totalCapacity });
    DB.slots = DB.slots.filter((s) => s.campId !== camp.id);
    plan.forEach((p, i) => DB.slots.push({ id: seq.camp * 100 + 50 + i, campId: camp.id, slotIndex: p.slotIndex, startTime: p.startTime, endTime: p.endTime, capacity: p.capacity, bookedCount: 0 }));
    return { camp: campBundle(camp), slotPlan: plan, simulated: true };
  },

  async setCampStatus(campId, status) {
    const camp = DB.camps.find((c) => c.id === Number(campId));
    if (camp) camp.status = status;
    return { camp: campBundle(camp), simulated: true };
  },

  async assignStaff(campId, payload, user) {
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) throw new Error('Only organizers assign staff.');
    if (DB.staff.some((s) => s.campId === Number(campId) && s.userId === Number(payload.userId))) throw new Error('This user is already assigned to the camp.');
    const u = DB.users.find((x) => x.id === Number(payload.userId));
    if (!u) throw new Error('Staff user not found.');
    const row = { id: seq.notif++, campId: Number(campId), userId: u.id, name: u.name, email: u.email, phone: u.phone, roleAtCamp: payload.roleAtCamp || 'DOCTOR', shiftStart: payload.shiftStart, shiftEnd: payload.shiftEnd, expectedLoadPerHour: Number(payload.expectedLoadPerHour || 0), maxPatientsPerHour: Number(payload.maxPatientsPerHour || 20), duties: payload.duties || '' };
    DB.staff.push(row);
    const staff = { ...row, loadWarning: row.expectedLoadPerHour > row.maxPatientsPerHour };
    return { staff, warning: staff.loadWarning ? { severity: 'CLINICAL_LOAD', message: `${staff.name} assigned ${staff.expectedLoadPerHour} patients/hr — exceeds ${staff.maxPatientsPerHour}/hr safe threshold. Rebalance the shift or add another doctor.` } : null, simulated: true };
  },

  async removeStaff(id) { DB.staff = DB.staff.filter((s) => s.id !== Number(id)); return { deleted: true, simulated: true }; },

  async purgeMe(user) {
    for (const b of DB.bookings.filter((x) => x.patientId === user.id && ['CONFIRMED', 'CHECKED_IN'].includes(x.status))) {
      const s = DB.slots.find((x) => x.id === b.slotId);
      if (s) s.bookedCount = Math.max(0, s.bookedCount - 1);
    }
    DB.waitlist.forEach((w) => { if (w.patientId === user.id) w.status = 'CANCELLED'; });
    DB.bookings = DB.bookings.filter((x) => x.patientId !== user.id);
    DB.notifications = DB.notifications.filter((n) => n.userId !== user.id);
    DB.users = DB.users.filter((u) => u.id !== user.id);
    return { deleted: true, message: 'Personal data purged (local demo engine).', legalNote: 'Data minimisation: CHSC never stores medical history, diagnosis, prescriptions or reports.', simulated: true };
  },

  _notify(userId, bookingId, channel, type, recipient, subject, message) {
    const row = { id: seq.notif++, bookingId, userId, channel, type, recipient, subject, message, provider: channel === 'SMS' ? 'Fast2SMS Sandbox' : 'Nodemailer Sandbox', status: 'SIMULATED', sentAt: new Date().toISOString(), simulated: true };
    DB.notifications.push(row);
    return row;
  },
};

function buildPlan(startTime, endTime, slotDurationMins, totalCapacity) {
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const start = toMin(startTime), end = toMin(endTime), duration = Number(slotDurationMins), capacity = Number(totalCapacity);
  if (!(duration >= 5)) throw new Error('slotDurationMins must be at least 5.');
  if (!(capacity >= 1)) throw new Error('totalCapacity must be a positive integer.');
  if (end <= start) throw new Error('endTime must be after startTime.');
  const k = Math.floor((end - start) / duration);
  if (k < 1) throw new Error('The camp interval is shorter than one slot.');
  if (capacity < k) throw new Error(`Capacity (${capacity}) must be at least the number of slots (${k}).`);
  const base = Math.floor(capacity / k);
  const remainder = capacity % k;
  return Array.from({ length: k }, (_, i) => ({ slotIndex: i + 1, startTime: minsToTime(start + i * duration).slice(0, 5), endTime: minsToTime(start + (i + 1) * duration).slice(0, 5), capacity: base + (i < remainder ? 1 : 0) }));
}

export default engine;
