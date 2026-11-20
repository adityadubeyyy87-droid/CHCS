'use strict';

const {
  app,
  request,
  pool,
  insertUser,
  createCampAt,
  countRows,
} = require('../helpers/api');

const DAY = '2099-08-14';

function assign({ token, campId, userId, shiftStart, shiftEnd, roleAtCamp = 'DOCTOR', body = {} }) {
  return request(app)
    .post(`/api/camps/${campId}/staff`)
    .set('Authorization', `Bearer ${token}`)
    .send({ userId, roleAtCamp, shiftStart, shiftEnd, ...body });
}

describe('staff assignment — overlap protection', () => {
  it('assigns a doctor to a shift', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR', name: 'Dr Overlap' });
    const camp = await createCampAt({
      campDate: DAY,
      startTime: '09:00:00',
      endTime: '13:00:00',
      capacity: 10,
    });

    const response = await assign({
      token: organizer.token,
      campId: camp.campId,
      userId: doctor.id,
      shiftStart: '09:00',
      shiftEnd: '13:00',
    }).expect(201);

    expect(response.body.staff.userId).toBe(doctor.id);
    expect(response.body.staff.roleAtCamp).toBe('DOCTOR');
  });

  it('blocks the same person twice in one camp', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const nurse = await insertUser({ role: 'VOLUNTEER' });
    const camp = await createCampAt({
      campDate: DAY,
      startTime: '09:00:00',
      endTime: '13:00:00',
    });

    await assign({
      token: organizer.token,
      campId: camp.campId,
      userId: nurse.id,
      shiftStart: '09:00',
      shiftEnd: '11:00',
    }).expect(201);

    const duplicate = await assign({
      token: organizer.token,
      campId: camp.campId,
      userId: nurse.id,
      shiftStart: '11:00',
      shiftEnd: '13:00',
    }).expect(409);
    expect(duplicate.body.code).toBe('STAFF_ALREADY_ASSIGNED');
  });

  it('blocks overlapping shifts across two camps on the same day', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR' });

    const morning = await createCampAt({
      campDate: DAY,
      startTime: '09:00:00',
      endTime: '12:00:00',
    });
    const midday = await createCampAt({
      campDate: DAY,
      startTime: '11:00:00',
      endTime: '15:00:00',
    });

    await assign({
      token: organizer.token,
      campId: morning.campId,
      userId: doctor.id,
      shiftStart: '09:00',
      shiftEnd: '12:00',
    }).expect(201);

    const conflict = await assign({
      token: organizer.token,
      campId: midday.campId,
      userId: doctor.id,
      shiftStart: '11:00',
      shiftEnd: '14:00',
    }).expect(409);

    expect(conflict.body.code).toBe('STAFF_OVERLAP');
    expect(conflict.body.details.conflicts).toHaveLength(1);
    expect(conflict.body.details.conflicts[0].campId).toBe(morning.campId);
    expect(conflict.body.details.conflicts[0].shiftStart).toBe('09:00:00');
  });

  it('allows adjacent (half-open) shifts and a different day', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR' });

    const morning = await createCampAt({ campDate: DAY, startTime: '09:00:00', endTime: '12:00:00' });
    const afternoon = await createCampAt({
      campDate: DAY,
      startTime: '12:00:00',
      endTime: '16:00:00',
    });
    const nextDay = await createCampAt({
      campDate: '2099-08-15',
      startTime: '09:00:00',
      endTime: '17:00:00',
    });

    await assign({
      token: organizer.token,
      campId: morning.campId,
      userId: doctor.id,
      shiftStart: '09:00',
      shiftEnd: '12:00',
    }).expect(201);

    // Back-to-back is fine: [09:00, 12:00) and [12:00, 16:00) do not overlap.
    await assign({
      token: organizer.token,
      campId: afternoon.campId,
      userId: doctor.id,
      shiftStart: '12:00',
      shiftEnd: '16:00',
    }).expect(201);

    await assign({
      token: organizer.token,
      campId: nextDay.campId,
      userId: doctor.id,
      shiftStart: '09:00',
      shiftEnd: '17:00',
    }).expect(201);

    expect(
      await countRows('SELECT COUNT(*) FROM staff_assignments WHERE user_id = ?', [doctor.id]),
    ).toBe(3);
  });

  it('lets one simultaneous request win when two organizers race the same doctor', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR' });
    const first = await createCampAt({ campDate: DAY, startTime: '09:00:00', endTime: '13:00:00' });
    const second = await createCampAt({ campDate: DAY, startTime: '10:00:00', endTime: '14:00:00' });

    const results = await Promise.all([
      assign({
        token: organizer.token,
        campId: first.campId,
        userId: doctor.id,
        shiftStart: '09:00',
        shiftEnd: '13:00',
      }),
      assign({
        token: organizer.token,
        campId: second.campId,
        userId: doctor.id,
        shiftStart: '10:00',
        shiftEnd: '14:00',
      }),
    ]);

    const codes = results.map((result) => result.status).sort();
    expect(codes).toEqual([201, 409]);
    expect(
      await countRows('SELECT COUNT(*) FROM staff_assignments WHERE user_id = ?', [doctor.id]),
    ).toBe(1);
  });

  it('rejects inverted shifts, unknown users and patient tokens', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR' });
    const camp = await createCampAt({ campDate: DAY, startTime: '09:00:00', endTime: '13:00:00' });

    const inverted = await assign({
      token: organizer.token,
      campId: camp.campId,
      userId: doctor.id,
      shiftStart: '14:00',
      shiftEnd: '09:00',
    }).expect(400);
    expect(inverted.body.code).toBe('INVALID_SHIFT');

    const missing = await assign({
      token: organizer.token,
      campId: camp.campId,
      userId: 999999,
      shiftStart: '09:00',
      shiftEnd: '13:00',
    }).expect(404);
    expect(missing.body.code).toBe('USER_NOT_FOUND');

    const asPatient = await assign({
      token: doctor.token,
      campId: camp.campId,
      userId: doctor.id,
      shiftStart: '09:00',
      shiftEnd: '13:00',
    }).expect(403);
    expect(asPatient.body.code).toBe('ROLE_FORBIDDEN');
  });

  it('reports a clinical load warning without blocking the assignment', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR' });
    const camp = await createCampAt({ campDate: DAY, startTime: '09:00:00', endTime: '13:00:00' });

    const response = await assign({
      token: organizer.token,
      campId: camp.campId,
      userId: doctor.id,
      shiftStart: '09:00',
      shiftEnd: '13:00',
      roleAtCamp: 'DOCTOR',
      body: { expectedLoadPerHour: 34, maxPatientsPerHour: 20 },
    }).expect(201);

    expect(response.body.warning).toMatchObject({ severity: 'CLINICAL_LOAD' });
    expect(response.body.staff.loadWarning).toBeTruthy();
    expect(response.body.warning.message).toContain('34');
  });
});
