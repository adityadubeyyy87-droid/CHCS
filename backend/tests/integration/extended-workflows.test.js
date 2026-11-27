'use strict';

/**
 * Extended CHSC workflows: family/prescreening/feedback, manual promotion,
 * service records, walk-ins, approvals, org settings, account administration
 * and the MySQL-backed inbox. Every assertion runs against the real Express
 * app and the real test MySQL schema built by global-setup.js.
 */

const {
  app,
  request,
  pool,
  insertUser,
  createCampFixture,
  book,
  assignStaff,
  insertInAppNotification,
  uniqueEmail,
  localDate,
  countRows,
} = require('../helpers/api');

const auth = (token) => `Bearer ${token}`;

describe('extended workflows', () => {
  it('stores family bookings, pre-screening and post-camp feedback', async () => {
    const patient = await insertUser({ role: 'PATIENT', name: 'Family Patient' });
    const organizer = await insertUser({ role: 'ORGANIZER', name: 'Feedback Organizer' });
    const fixture = await createCampFixture({ organizerId: organizer.id, capacity: 4 });

    const memberResponse = await request(app)
      .post('/api/family')
      .set('Authorization', auth(patient.token))
      .send({ name: 'Anita Rao', age: 42, relationship: 'Parent' })
      .expect(201);
    const memberId = memberResponse.body.member.id;

    const created = await book({
      token: patient.token,
      slotId: fixture.slotId,
      body: { familyMemberId: memberId },
    });
    expect(created.body.booking.familyMemberId).toBe(memberId);

    const bookingId = created.body.booking.id;
    const prescreening = {
      ageGroup: '46-60',
      conditions: ['none'],
      mobilityNeeds: false,
      preferredLanguage: 'English',
      emergencyContactName: 'Ramesh Rao',
      emergencyContactPhone: '9876543210',
    };
    await request(app)
      .post(`/api/bookings/${bookingId}/prescreening`)
      .set('Authorization', auth(patient.token))
      .send(prescreening)
      .expect(201);

    const mine = await request(app)
      .get('/api/bookings/me')
      .set('Authorization', auth(patient.token))
      .expect(200);
    const row = mine.body.bookings.find((item) => item.id === bookingId);
    expect(row.familyMemberName).toBe('Anita Rao');
    expect(row.prescreened).toBe(true);

    await request(app)
      .post(`/api/bookings/${bookingId}/feedback`)
      .set('Authorization', auth(patient.token))
      .send({ rating: 5, comment: 'Organised, clear queue.' })
      .expect(201);

    const feedback = await request(app)
      .get(`/api/feedback/organizer?campId=${fixture.campId}`)
      .set('Authorization', auth(organizer.token))
      .expect(200);
    expect(feedback.body.summary.responses).toBe(1);
    expect(feedback.body.feedback[0].rating).toBe(5);
    expect(feedback.body.provenance).toBe('live-mysql');
  });

  it('audits a manual waitlist promotion with its override reason', async () => {
    const admin = await insertUser({ role: 'ADMIN', name: 'Promotion Admin' });
    const organizer = await insertUser({ role: 'ORGANIZER', name: 'Promotion Organizer' });
    const patient = await insertUser({ role: 'PATIENT', name: 'Waiting Patient' });
    const fixture = await createCampFixture({ organizerId: organizer.id, capacity: 2 });

    const [waitlist] = await pool.query(
      `INSERT INTO waitlist (slot_id, camp_id, patient_id, position, status)
       VALUES (?, ?, ?, 1, 'WAITING')`,
      [fixture.slotId, fixture.campId, patient.id],
    );

    const promoted = await request(app)
      .post(`/api/camps/${fixture.campId}/waitlist/${waitlist.insertId}/promote`)
      .set('Authorization', auth(organizer.token))
      .send({ reason: 'Accessibility need agreed with the patient' })
      .expect(200);
    expect(promoted.body.status).toBe('PROMOTED');
    expect(promoted.body.manualOverride).toBe(true);

    const log = await request(app)
      .get('/api/admin/audit-log?page=1&pageSize=50')
      .set('Authorization', auth(admin.token))
      .expect(200);
    const audit = log.body.audit.find((row) => row.action === 'MANUAL_PROMOTE_WAITLIST'
      && Number(row.targetId) === Number(promoted.body.booking.id));
    expect(audit).toBeTruthy();
    expect(audit.after).toEqual(expect.objectContaining({
      manual_override: true,
      reason: 'Accessibility need agreed with the patient',
    }));
  });

  it('serves the live service queue and records services and quick notes', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER', name: 'Service Organizer' });
    const doctor = await insertUser({ role: 'DOCTOR', name: 'Queue Doctor' });
    const patient = await insertUser({ role: 'PATIENT', name: 'Queue Patient' });
    const fixture = await createCampFixture({ organizerId: organizer.id, capacity: 3 });
    await assignStaff(doctor, fixture.campId, 'DOCTOR');

    const created = await book({ token: patient.token, slotId: fixture.slotId });
    const bookingId = created.body.booking.id;
    await request(app)
      .post('/api/checkin')
      .set('Authorization', auth(doctor.token))
      .send({ qrToken: created.body.booking.qrToken })
      .expect(200);

    const lookup = await request(app)
      .post('/api/checkin/lookup')
      .set('Authorization', auth(doctor.token))
      .send({ phone: patient.phone, campId: fixture.campId })
      .expect(200);
    expect(lookup.body.matches.some((row) => row.id === bookingId)).toBe(true);

    const queue = await request(app)
      .get(`/api/camps/${fixture.campId}/service-queue`)
      .set('Authorization', auth(doctor.token))
      .expect(200);
    expect(queue.body.patients).toHaveLength(1);
    expect(queue.body.avgServiceTimeMinutes).toBeGreaterThan(0);
    expect(queue.body.patients[0].status).toBe('WAITING');

    await request(app)
      .post(`/api/bookings/${bookingId}/service-records`)
      .set('Authorization', auth(doctor.token))
      .send({ serviceName: 'BP', outcome: 'Within range', complete: true })
      .expect(201);
    await request(app)
      .post(`/api/bookings/${bookingId}/notes`)
      .set('Authorization', auth(doctor.token))
      .send({ note: 'Advised annual follow-up' })
      .expect(201);

    const updated = await request(app)
      .get(`/api/camps/${fixture.campId}/service-queue`)
      .set('Authorization', auth(doctor.token))
      .expect(200);
    expect(updated.body.patients[0].services.find((row) => row.name === 'BP').completed).toBe(true);
    expect(updated.body.patients[0].notes).toContain('Advised annual follow-up');
  });

  it('registers a real walk-in and returns a one-time credential for a new phone', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER', name: 'Desk Organizer' });
    const fixture = await createCampFixture({ organizerId: organizer.id, capacity: 4 });
    const email = uniqueEmail('walkin');

    const response = await request(app)
      .post('/api/walkins')
      .set('Authorization', auth(organizer.token))
      .send({ name: 'Desk Patient', phone: `9${Math.floor(100000000 + Math.random() * 900000000)}`, email, slotId: fixture.slotId })
      .expect(201);
    expect(response.body.status).toBe('CONFIRMED');
    expect(response.body.booking.tokenNumber).toBeTruthy();
    expect(response.body.temporaryPassword).toBeTruthy();
    expect(await countRows('SELECT COUNT(*) AS total FROM users WHERE email = ?', [email])).toBe(1);
  });

  it('skips EMAIL for phone-only walk-ins during promotion and announcements', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER', name: 'Phone-only Organizer' });
    const fixture = await createCampFixture({ organizerId: organizer.id, capacity: 1 });
    const phoneOne = `9${String(Date.now()).slice(-9)}`;
    const phoneTwo = `9${String(Date.now() + 1).slice(-9)}`;

    const seated = await request(app)
      .post('/api/walkins')
      .set('Authorization', auth(organizer.token))
      .send({ name: 'Phone Only One', phone: phoneOne, slotId: fixture.slotId })
      .expect(201);
    const waiting = await request(app)
      .post('/api/walkins')
      .set('Authorization', auth(organizer.token))
      .send({ name: 'Phone Only Two', phone: phoneTwo, slotId: fixture.slotId, joinWaitlist: true })
      .expect(201);

    const [[seatedUser]] = await pool.query('SELECT email FROM users WHERE id = ?', [
      seated.body.patient.id,
    ]);
    const [[waitingUser]] = await pool.query('SELECT email FROM users WHERE id = ?', [
      waiting.body.patient.id,
    ]);
    expect(seatedUser.email).toBeNull();
    expect(waitingUser.email).toBeNull();

    // Open a seat without cancelling (which would auto-promote the waiter) so
    // this test exercises the explicit manual-override path.
    await pool.query('UPDATE slots SET capacity = capacity + 1 WHERE id = ?', [fixture.slotId]);

    await request(app)
      .post(`/api/camps/${fixture.campId}/waitlist/${waiting.body.waitlistId}/promote`)
      .set('Authorization', auth(organizer.token))
      .send({ reason: 'Seat available at the desk' })
      .expect(200);

    const [[{ emailRows }]] = await pool.query(
      `SELECT COUNT(*) AS emailRows FROM notifications_log
       WHERE user_id IN (?, ?) AND channel = 'EMAIL'`,
      [seated.body.patient.id, waiting.body.patient.id],
    );
    expect(Number(emailRows)).toBe(0);

    const [[{ emailUsers }]] = await pool.query(
      `SELECT COUNT(*) AS emailUsers FROM users
       WHERE is_active = 1 AND role = 'PATIENT'
         AND email IS NOT NULL AND TRIM(email) <> ''`,
    );
    const announcement = await request(app)
      .post('/api/announcements')
      .set('Authorization', auth(organizer.token))
      .send({ subject: 'Camp desk update', message: 'Service starts shortly.', audience: 'PATIENTS' })
      .expect(202);
    expect(announcement.body.recipientCount).toBe(Number(emailUsers));
    expect(announcement.body.recipientCount).toBeLessThan(
      await countRows('SELECT COUNT(*) AS n FROM users WHERE is_active = 1'),
    );
  });

  it('approves a pending camp and writes the approver to the audit log', async () => {
    const admin = await insertUser({ role: 'ADMIN', name: 'Approval Admin' });
    const organizer = await insertUser({ role: 'ORGANIZER', name: 'Approval Organizer' });
    const fixture = await createCampFixture({
      organizerId: organizer.id,
      capacity: 3,
      status: 'DRAFT',
    });
    await pool.query(
      "UPDATE camps SET approval_status = 'PENDING' WHERE id = ?",
      [fixture.campId],
    );
    await request(app)
      .post(`/api/admin/camps/${fixture.campId}/reject`)
      .set('Authorization', auth(admin.token))
      .send({ reason: 'Venue permission letter is missing.' })
      .expect(200);

    const stranger = await insertUser({ role: 'ORGANIZER', name: 'Other Organizer' });
    const scoped = await request(app)
      .post(`/api/camps/${fixture.campId}/submit-approval`)
      .set('Authorization', auth(stranger.token))
      .send({ note: 'Trying another organizer’s camp.' })
      .expect(403);
    expect(scoped.body.code).toBe('CAMP_SCOPE_FORBIDDEN');

    const resubmitted = await request(app)
      .post(`/api/camps/${fixture.campId}/submit-approval`)
      .set('Authorization', auth(organizer.token))
      .send({ note: 'Venue permission letter uploaded.' })
      .expect(200);
    expect(resubmitted.body.camp.approvalStatus).toBe('PENDING');

    const mine = await request(app)
      .get('/api/admin/camps/approvals')
      .set('Authorization', auth(organizer.token))
      .expect(200);
    expect(mine.body.camps.some((camp) => camp.id === fixture.campId)).toBe(true);

    const approved = await request(app)
      .post(`/api/admin/camps/${fixture.campId}/approve`)
      .set('Authorization', auth(admin.token))
      .expect(200);
    expect(approved.body.camp.approvalStatus).toBe('APPROVED');
    expect(approved.body.camp.status).toBe('PUBLISHED');

    const log = await request(app)
      .get('/api/admin/audit-log?page=1&pageSize=50')
      .set('Authorization', auth(admin.token))
      .expect(200);
    expect(log.body.audit.some((row) => row.action === 'APPROVE_CAMP'
      && Number(row.targetId) === fixture.campId)).toBe(true);
  });

  it('round-trips organisation settings and rejects paid SMS mode', async () => {
    const admin = await insertUser({ role: 'ADMIN', name: 'Settings Admin' });
    const patient = await insertUser({ role: 'PATIENT', name: 'Settings Patient' });
    const before = await request(app)
      .get('/api/org/settings')
      .set('Authorization', auth(patient.token))
      .expect(200);
    const original = before.body;

    const payload = {
      organizationName: '社区 Health Initiative',
      logoUrl: '',
      contactEmail: 'hello@chsc.test',
      defaultSlotDuration: 25,
      bookingHoldMinutes: 12,
      requireCampApproval: true,
      supportedLanguages: ['en', 'kn', 'hi'],
      emailProviderMode: 'SANDBOX',
      smsProviderMode: 'SANDBOX',
    };
    try {
      await request(app)
        .put('/api/org/settings')
        .set('Authorization', auth(admin.token))
        .send(payload)
        .expect(200);

      const after = await request(app)
        .get('/api/org/settings')
        .set('Authorization', auth(patient.token))
        .expect(200);
      expect(after.body.organizationName).toBe(payload.organizationName);
      expect(after.body.bookingHoldMinutes).toBe(12);
      expect(after.body.requireCampApproval).toBe(true);
      expect(after.body.supportedLanguages).toEqual(['en', 'kn', 'hi']);
      expect(after.body.provenance).toBe('live-mysql');

      const paidSms = await request(app)
        .put('/api/org/settings')
        .set('Authorization', auth(admin.token))
        .send({ ...payload, smsProviderMode: 'LIVE' })
        .expect(400);
      expect(paidSms.body.code).toBe('PAID_SMS_DISABLED');
    } finally {
      await request(app)
        .put('/api/org/settings')
        .set('Authorization', auth(admin.token))
        .send({
          organizationName: original.organizationName,
          logoUrl: original.logoUrl || '',
          contactEmail: original.contactEmail,
          defaultSlotDuration: original.defaultSlotDuration,
          bookingHoldMinutes: original.bookingHoldMinutes,
          requireCampApproval: original.requireCampApproval,
          supportedLanguages: original.supportedLanguages,
          emailProviderMode: original.emailProviderMode,
          smsProviderMode: original.smsProviderMode,
        })
        .expect(200);
    }
  });

  it('creates, searches, resets and deletes accounts, but protects history', async () => {
    const admin = await insertUser({ role: 'ADMIN', name: 'User Admin' });
    const email = uniqueEmail('created');
    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', auth(admin.token))
      .send({ name: 'Created Staff', email, phone: `8${Math.floor(100000000 + Math.random() * 900000000)}`, role: 'VOLUNTEER' })
      .expect(201);
    expect(created.body.temporaryPassword).toBeTruthy();
    const userId = created.body.user.id;

    const list = await request(app)
      .get(`/api/admin/users?q=${encodeURIComponent(email)}&page=1&pageSize=20`)
      .set('Authorization', auth(admin.token))
      .expect(200);
    expect(list.body.users.some((row) => row.id === userId)).toBe(true);
    expect(list.body.pagination.total).toBeGreaterThan(0);

    const reset = await request(app)
      .post(`/api/admin/users/${userId}/reset-password`)
      .set('Authorization', auth(admin.token))
      .expect(200);
    expect(reset.body.temporaryPassword).toBeTruthy();

    const removed = await request(app)
      .delete(`/api/admin/users/${userId}`)
      .set('Authorization', auth(admin.token))
      .expect(200);
    expect(removed.body.deleted).toBe(true);

    const patient = await insertUser({ role: 'PATIENT', name: 'History Patient' });
    const fixture = await createCampFixture({ organizerId: admin.id, capacity: 2 });
    await book({ token: patient.token, slotId: fixture.slotId });
    const protectedDelete = await request(app)
      .delete(`/api/admin/users/${patient.id}`)
      .set('Authorization', auth(admin.token))
      .expect(409);
    expect(protectedDelete.body.code).toBe('USER_HAS_HISTORY');
  });

  it('serves and updates the MySQL-backed notification inbox', async () => {
    const patient = await insertUser({ role: 'PATIENT', name: 'Inbox Patient' });
    await insertInAppNotification(pool, {
      userId: patient.id,
      type: 'BOOKING_CONFIRMED',
      message: 'Your screening pass is confirmed.',
    });
    await insertInAppNotification(pool, {
      userId: patient.id,
      type: 'ANNOUNCEMENT',
      message: 'Camp timings have been published.',
    });

    const first = await request(app)
      .get('/api/notifications/inbox?page=1&pageSize=20')
      .set('Authorization', auth(patient.token))
      .expect(200);
    expect(first.body.notifications).toHaveLength(2);
    expect(first.body.unread).toBe(2);

    const target = first.body.notifications[0];
    await request(app)
      .patch(`/api/notifications/inbox/${target.id}/read`)
      .set('Authorization', auth(patient.token))
      .expect(200);
    const afterOne = await request(app)
      .get('/api/notifications/inbox?page=1&pageSize=20')
      .set('Authorization', auth(patient.token))
      .expect(200);
    expect(afterOne.body.unread).toBe(1);

    await request(app)
      .post('/api/notifications/inbox/read-all')
      .set('Authorization', auth(patient.token))
      .expect(200);
    const afterAll = await request(app)
      .get('/api/notifications/inbox?page=1&pageSize=20')
      .set('Authorization', auth(patient.token))
      .expect(200);
    expect(afterAll.body.unread).toBe(0);
  });

  it('serves templates, clones a real camp and maintains the checklist', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER', name: 'Planning Organizer' });
    // Eight one-hour slots fit the 09:00–17:00 clone window with at least one
    // seat each; buildSlotPlan rejects a smaller camp capacity honestly.
    const fixture = await createCampFixture({ organizerId: organizer.id, capacity: 8 });

    const templates = await request(app)
      .get('/api/camp-templates')
      .set('Authorization', auth(organizer.token))
      .expect(200);
    expect(templates.body.templates.length).toBeGreaterThan(0);
    expect(templates.body.provenance).toBe('catalog');

    const added = await request(app)
      .post(`/api/camps/${fixture.campId}/checklist`)
      .set('Authorization', auth(organizer.token))
      .send({ item: 'Confirm the venue keys' })
      .expect(201);
    const itemId = added.body.item.id;
    await request(app)
      .patch(`/api/checklist/${itemId}`)
      .set('Authorization', auth(organizer.token))
      .send({ isDone: true })
      .expect(200);
    const checklist = await request(app)
      .get(`/api/camps/${fixture.campId}/checklist`)
      .set('Authorization', auth(organizer.token))
      .expect(200);
    expect(checklist.body.items.find((item) => item.id === itemId).isDone).toBe(true);

    const cloned = await request(app)
      .post(`/api/camps/${fixture.campId}/clone`)
      .set('Authorization', auth(organizer.token))
      .send({
        title: 'Cloned Planning Camp',
        campDate: localDate(new Date(Date.now() + 7 * 24 * 3600 * 1000)),
        startTime: '09:00',
        endTime: '17:00',
        venue: 'Test Venue',
        address: 'Test address, Bengaluru',
      })
      .expect(201);
    expect(cloned.body.camp.id).not.toBe(fixture.campId);
    expect(cloned.body.camp.status).toBe('DRAFT');
  });

  it('enforces camp scope for unassigned staff on the service queue', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER', name: 'Scope Organizer' });
    const doctor = await insertUser({ role: 'DOCTOR', name: 'Unassigned Doctor' });
    const fixture = await createCampFixture({ organizerId: organizer.id, capacity: 2 });

    const response = await request(app)
      .get(`/api/camps/${fixture.campId}/service-queue`)
      .set('Authorization', auth(doctor.token))
      .expect(403);
    expect(response.body.code).toBe('CAMP_SCOPE_FORBIDDEN');

    const stranger = await insertUser({ role: 'ORGANIZER', name: 'Unassigned Organizer' });
    const feedbackScope = await request(app)
      .get(`/api/feedback/organizer?campId=${fixture.campId}`)
      .set('Authorization', auth(stranger.token))
      .expect(403);
    expect(feedbackScope.body.code).toBe('CAMP_SCOPE_FORBIDDEN');

    const cloneScope = await request(app)
      .post(`/api/camps/${fixture.campId}/clone`)
      .set('Authorization', auth(stranger.token))
      .send({
        campDate: localDate(new Date(Date.now() + 7 * 24 * 3600 * 1000)),
        startTime: '09:00',
        endTime: '17:00',
      })
      .expect(403);
    expect(cloneScope.body.code).toBe('CAMP_SCOPE_FORBIDDEN');
  });
});
