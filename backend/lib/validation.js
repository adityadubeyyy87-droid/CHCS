'use strict';

/**
 * Request validation — every mutating endpoint validates its body with zod
 * before touching the database. Failures are surfaced through the same
 * `{ ok:false, error, code, details }` envelope as every other API error.
 */

const { z } = require('zod');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const time = z.string().regex(HHMM, 'Expected HH:MM (24-hour).');
const isoDate = z
  .string()
  .regex(ISO_DATE, 'Expected YYYY-MM-DD.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00`)), 'Not a real calendar date.');
const positiveInt = z.coerce.number().int().positive();
const capacity = z.coerce.number().int().min(1).max(100000);
const optionalIsoDate = z.union([z.literal(''), isoDate]).optional().default('');
const campTypeOrAll = z
  .enum(['ALL', 'GENERAL', 'EYE', 'DENTAL', 'BLOOD_DONATION', 'MATERNAL'])
  .optional()
  .default('ALL');

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(190);
const phone = z.string().trim().regex(/^[0-9]{10}$/, 'Phone must be a 10-digit Indian mobile number.');
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.')
  .regex(/[A-Za-z]/, 'Password must include a letter.')
  .regex(/[0-9]/, 'Password must include a number.');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(120),
  email,
  phone,
  password,
  ageGroup: z.enum(['18-29', '30-45', '46-60', '60+']).nullish(),
  preferredLanguage: z.enum(['en', 'kn']).default('en'),
});

const loginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(190).optional(),
    email: z.string().trim().min(3).max(190).optional(),
    phone: z.string().trim().min(3).max(20).optional(),
    password: z.string().min(1, 'Password is required.').max(200),
  })
  .refine((value) => Boolean(value.identifier || value.email || value.phone), {
    message: 'Email or phone is required.',
    path: ['identifier'],
  });

const campWindow = {
  startTime: time,
  endTime: time,
  slotDurationMins: z.coerce.number().int().min(5, 'A slot must last at least 5 minutes.').max(720),
  totalCapacity: capacity,
  physicalCapacity: capacity.optional(),
};

// Optional coordinates: blank strings mean "not supplied" instead of coercing
// to 0 (which would put the camp in the Atlantic). Explicit null clears them.
const coordinate = (min, max) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().min(min).max(max).nullable().optional(),
  );
const latitude = coordinate(-90, 90);
const longitude = coordinate(-180, 180);

const campCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    descriptionEn: z.string().max(5000).optional().default(''),
    descriptionKn: z.string().max(5000).optional().default(''),
    venue: z.string().trim().min(2).max(180),
    address: z.string().trim().min(4).max(255),
    city: z.string().trim().min(2).max(80).default('Bengaluru'),
    latitude: latitude,
    longitude: longitude,
    campDate: isoDate,
    status: z.enum(['DRAFT', 'PUBLISHED']).default('PUBLISHED'),
    campType: z
      .enum(['GENERAL', 'EYE', 'DENTAL', 'BLOOD_DONATION', 'MATERNAL'])
      .optional()
      .default('GENERAL'),
    serviceChecklist: z.array(z.string().trim().min(2).max(100)).max(20).optional().default([]),
    avgServiceTimeMins: z.coerce.number().int().min(1).max(240).optional().default(12),
    checklist: z.array(z.string().trim().min(2).max(500)).max(40).optional().default([]),
    cloneFromId: positiveInt.optional(),
    ...campWindow,
  })
  .refine((value) => value.endTime > value.startTime, {
    message: 'endTime must be after startTime.',
    path: ['endTime'],
  });

const campUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(180).optional(),
    descriptionEn: z.string().max(5000).optional(),
    descriptionKn: z.string().max(5000).optional(),
    venue: z.string().trim().min(2).max(180).optional(),
    address: z.string().trim().min(4).max(255).optional(),
    city: z.string().trim().min(2).max(80).optional(),
    latitude: latitude,
    longitude: longitude,
  })
  .refine((value) => Object.keys(value).length > 0, 'No fields to update.');

const campStatusSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED']),
});

const generateSlotsSchema = z.object({
  ...campWindow,
  force: z.boolean().optional().default(false),
  destructive: z.boolean().optional().default(false),
});

/** Capacity Advisor query parameters: finite, bounded and explicitly numeric. */
const advisorQuerySchema = z.object({
  physicalCapacity: z.coerce.number().int().min(1).max(100000).default(100),
  // Leave absent so the server's ALPHA_MAX environment setting is honoured.
  alphaMax: z.coerce.number().min(0).max(1).optional(),
});

const staffAssignSchema = z.object({
  userId: positiveInt,
  roleAtCamp: z.enum(['DOCTOR', 'VOLUNTEER', 'NURSE', 'COORDINATOR']).default('DOCTOR'),
  shiftStart: time,
  shiftEnd: time,
  expectedLoadPerHour: z.coerce.number().int().min(0).max(500).default(0),
  maxPatientsPerHour: z.coerce.number().int().min(1).max(500).default(20),
  duties: z.string().max(255).optional().default(''),
});

const prescreeningSchema = z.object({
  ageGroup: z.enum(['18-29', '30-45', '46-60', '60+']),
  conditions: z
    .array(z.enum(['diabetes', 'hypertension', 'heart disease', 'none']))
    .min(1, 'Select at least one option. Choose “none” if applicable.')
    .max(4)
    .refine(
      (values) => !(values.includes('none') && values.length > 1),
      '“none” cannot be combined with other conditions.',
    ),
  mobilityNeeds: z.boolean(),
  preferredLanguage: z.enum(['English', 'Kannada', 'Hindi']),
  emergencyContactName: z.string().trim().min(2).max(100),
  emergencyContactPhone: phone,
});

const bookingSchema = z.object({
  travelMode: z.enum(['WALK', 'AUTO_BUS', 'TWO_WHEELER', 'WITH_FAMILY']).nullish(),
  pledge: z.boolean().optional().default(false),
  familyMemberId: positiveInt.nullish(),
  prescreening: prescreeningSchema.optional(),
});

const familyMemberSchema = z.object({
  name: z.string().trim().min(2).max(100),
  age: z.coerce.number().int().min(0).max(120),
  relationship: z.enum(['Parent', 'Spouse', 'Child', 'Sibling', 'Grandparent', 'Other']),
});

const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional().default(''),
});

const walkinSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone,
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(190).optional(),
  age: z.coerce.number().int().min(0).max(120).optional().nullable(),
  slotId: positiveInt,
  source: z.enum(['walkin', 'WALKIN']).optional().default('walkin'),
  joinWaitlist: z.boolean().optional().default(false),
});

const promoteSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const broadcastSchema = z.object({
  subject: z.string().trim().min(3).max(190),
  message: z.string().trim().min(3).max(4000),
  audience: z.enum(['ALL', 'PATIENTS', 'STAFF']).optional().default('ALL'),
});

const campCloneSchema = z.object({
  title: z.string().trim().min(3).max(180).optional(),
  campDate: isoDate,
  startTime: time,
  endTime: time,
  venue: z.string().trim().min(2).max(180).optional(),
  address: z.string().trim().min(4).max(255).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional().default('DRAFT'),
});

const checkinLookupSchema = z
  .object({
    phone: phone.optional(),
    campId: positiveInt.optional(),
    token: z.string().trim().max(120).optional(),
  })
  .refine((value) => Boolean(value.phone || value.token), {
    message: 'Enter a phone number or QR token to look up a patient.',
    path: ['phone'],
  });

const checklistItemSchema = z.object({
  item: z.string().trim().min(2).max(500),
});

const checklistUpdateSchema = z.object({
  isDone: z.boolean(),
});

const serviceRecordSchema = z.object({
  serviceName: z.string().trim().min(2).max(100),
  outcome: z.string().trim().max(2000).optional().default(''),
  complete: z.boolean().optional().default(false),
});

const noteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

const adminUserCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  phone,
  role: z.enum(['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN']).default('PATIENT'),
});

const adminRoleSchema = z.object({
  role: z.enum(['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN']),
});

const adminStatusSchema = z.object({
  isActive: z.boolean(),
});

const campApprovalSchema = z.object({
  reason: z.string().trim().min(3).max(1000).optional().default(''),
});

const resubmitApprovalSchema = z.object({
  note: z.string().trim().max(1000).optional().default(''),
});

const orgSettingsSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  logoUrl: z.string().trim().max(500).optional().default(''),
  contactEmail: email,
  defaultSlotDuration: z.coerce.number().int().min(5).max(720),
  bookingHoldMinutes: z.coerce.number().int().min(1).max(120),
  requireCampApproval: z.boolean(),
  supportedLanguages: z.array(z.enum(['en', 'kn', 'hi'])).min(1).max(3),
  emailProviderMode: z.enum(['SANDBOX', 'LIVE']),
  smsProviderMode: z.enum(['SANDBOX', 'LIVE']),
});

const campFilterSchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  type: campTypeOrAll,
  from: optionalIsoDate,
  to: optionalIsoDate,
  openOnly: z.enum(['true', 'false', '1', '0']).optional().default('false'),
  sort: z.enum(['date', 'spots']).optional().default('date'),
  scope: z.enum(['public', 'manage']).optional().default('public'),
  page: z.coerce.number().int().min(1).max(1000000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(24),
});

const adminUserQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  page: z.coerce.number().int().min(1).max(1000000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const rescheduleSchema = z.object({
  slotId: positiveInt,
});

const attendanceSchema = z.object({
  status: z.enum(['CHECKED_IN', 'NO_SHOW', 'COMPLETED']),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000),
  pageSize: z.coerce.number().int().min(1).max(100),
});

function issuesOf(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** Express middleware factory. Parsed values replace req.body. */
function validateBody(schema) {
  return function validate(req, _res, next) {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const error = new Error('Request validation failed.');
      error.status = 400;
      error.code = 'VALIDATION_FAILED';
      error.details = { issues: issuesOf(parsed.error) };
      return next(error);
    }
    req.body = parsed.data;
    return next();
  };
}

/** Same envelope as validateBody but for req.query (GET endpoints). */
function validateQuery(schema) {
  return function validate(req, _res, next) {
    const parsed = schema.safeParse(req.query ?? {});
    if (!parsed.success) {
      const error = new Error('Invalid query parameters.');
      error.status = 400;
      error.code = 'VALIDATION_FAILED';
      error.details = { issues: issuesOf(parsed.error) };
      return next(error);
    }
    req.query = parsed.data;
    return next();
  };
}

module.exports = {
  schemas: {
    registerSchema,
    loginSchema,
    campCreateSchema,
    campUpdateSchema,
    campStatusSchema,
    generateSlotsSchema,
    staffAssignSchema,
    bookingSchema,
    rescheduleSchema,
    attendanceSchema,
    advisorQuerySchema,
    prescreeningSchema,
    familyMemberSchema,
    feedbackSchema,
    walkinSchema,
    promoteSchema,
    broadcastSchema,
    campCloneSchema,
    checkinLookupSchema,
    checklistItemSchema,
    checklistUpdateSchema,
    serviceRecordSchema,
    noteSchema,
    adminUserCreateSchema,
    adminRoleSchema,
    adminStatusSchema,
    campApprovalSchema,
    resubmitApprovalSchema,
    orgSettingsSchema,
    campFilterSchema,
    adminUserQuerySchema,
  },
  paginationSchema,
  validateBody,
  validateQuery,
  issuesOf,
  patterns: { HHMM, ISO_DATE },
};
