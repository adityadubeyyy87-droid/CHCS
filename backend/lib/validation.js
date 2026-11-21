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

const campCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    descriptionEn: z.string().max(5000).optional().default(''),
    descriptionKn: z.string().max(5000).optional().default(''),
    venue: z.string().trim().min(2).max(180),
    address: z.string().trim().min(4).max(255),
    city: z.string().trim().min(2).max(80).default('Bengaluru'),
    campDate: isoDate,
    status: z.enum(['DRAFT', 'PUBLISHED']).default('PUBLISHED'),
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

const bookingSchema = z.object({
  travelMode: z.enum(['WALK', 'AUTO_BUS', 'TWO_WHEELER', 'WITH_FAMILY']).nullish(),
  pledge: z.boolean().optional().default(false),
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
  },
  paginationSchema,
  validateBody,
  validateQuery,
  issuesOf,
  patterns: { HHMM, ISO_DATE },
};
