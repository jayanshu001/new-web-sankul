import { z } from "zod";
import {
  APPLICANT_EXPERIENCES,
  APPLICANT_GENDERS,
  CAREER_APPLICATION_STATUSES,
  CAREER_EXPERIENCE_LEVELS,
  CAREER_JOB_TYPES,
} from "./careers.types";

const MOBILE_NUMBER = /^[6-9]\d{9}$/;
const AGE_DIGITS = /^\d{1,2}$/;
const AMOUNT = /^\d{1,8}$/;
const OPTIONAL_AMOUNT = /^$|^\d{1,8}$/;

const MIN_AGE = 18;
const MAX_AGE = 65;
const MAX_PAGE_SIZE = 100;

const jobTypeSchema = z.enum(CAREER_JOB_TYPES);
const openingExperienceLevelSchema = z.enum(CAREER_EXPERIENCE_LEVELS);
const applicationStatusSchema = z.enum(CAREER_APPLICATION_STATUSES);

const pageSchema = z.coerce.number().int().positive().optional();
const limitSchema = z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional();

export const openingCreateSchema = z.object({
  title: z.string().min(1).max(255),
  department: z.string().max(255).optional(),
  location: z.string().max(255).optional(),
  jobType: jobTypeSchema.optional(),
  experienceLevel: openingExperienceLevelSchema.optional(),
  description: z.string().optional(),
  requirements: z.string().optional(),
  minSalary: z.coerce.number().nonnegative().optional(),
  maxSalary: z.coerce.number().nonnegative().optional(),
  vacancies: z.coerce.number().int().positive().optional(),
  lastDate: z.coerce.date().optional(),
  status: z.coerce.boolean().optional(),
});

export const openingUpdateSchema = openingCreateSchema.partial();

export const openingListQuerySchema = z.object({
  search: z.string().optional(),
  page: pageSchema,
  limit: limitSchema,
  status: z.coerce.boolean().optional(),
});

export const applicationCreateSchema = z.object({
  opening_id: z.coerce.bigint().optional().nullable(),
  job_title: z.string().max(255).optional().nullable(),
  full_name: z.string().min(1).max(255),
  email: z.union([z.literal(""), z.string().email()]).optional().nullable(),
  contact_number: z.string().regex(MOBILE_NUMBER, "Enter a valid 10-digit mobile number"),
  age: z
    .string()
    .regex(AGE_DIGITS, "Age must be a number up to 2 digits")
    .refine(
      (value) => Number(value) >= MIN_AGE && Number(value) <= MAX_AGE,
      `Age must be between ${MIN_AGE} and ${MAX_AGE}`
    ),
  gender: z.enum(APPLICANT_GENDERS),
  address: z.string().min(1),
  experience_level: z.enum(APPLICANT_EXPERIENCES),
  last_company: z.string().max(255).optional().nullable(),
  current_salary: z.string().regex(OPTIONAL_AMOUNT, "Enter a valid amount").optional().nullable(),
  expected_salary: z.string().regex(AMOUNT, "Enter a valid amount"),
  reason: z.string().optional().nullable(),
});

export type CareerApplicationBody = z.infer<typeof applicationCreateSchema>;

export const applicationListQuerySchema = z.object({
  openingId: z.coerce.bigint().optional(),
  status: applicationStatusSchema.optional(),
  page: pageSchema,
  limit: limitSchema,
});

export const applicationStatusUpdateSchema = z.object({ status: applicationStatusSchema });
