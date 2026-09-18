import { z } from "zod";

const jobType = z.enum(["full_time", "part_time", "contract", "internship"]);
const openingExperienceLevel = z.enum(["fresher", "experienced", "any"]);
const applicationStatus = z.enum(["new", "reviewing", "shortlisted", "rejected"]);

export const openingCreateSchema = z.object({
  title: z.string().min(1).max(255),
  department: z.string().max(255).optional(),
  location: z.string().max(255).optional(),
  jobType: jobType.optional(),
  experienceLevel: openingExperienceLevel.optional(),
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
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.coerce.boolean().optional(),
});

// Public apply form — mirrors the legacy `/v2/careers/apply` payload shape
// (`websankul-jobs`/`websankul-books` CareerForm.tsx) field-for-field, so the
// two frontends need no field-name changes, only the URL they POST to. Every
// value is validated as a string, matching the underlying VARCHAR columns.
export const applicationCreateSchema = z.object({
  opening_id: z.coerce.bigint().optional().nullable(),
  job_title: z.string().max(255).optional().nullable(),
  full_name: z.string().min(1).max(255),
  email: z.union([z.literal(""), z.string().email()]).optional().nullable(),
  contact_number: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  age: z
    .string()
    .regex(/^\d{1,2}$/, "Age must be a number up to 2 digits")
    .refine((v) => Number(v) >= 18 && Number(v) <= 65, "Age must be between 18 and 65"),
  gender: z.enum(["male", "female"]),
  address: z.string().min(1),
  experience_level: z.enum(["fresher", "experienced"]),
  last_company: z.string().max(255).optional().nullable(),
  current_salary: z.string().regex(/^$|^\d{1,8}$/, "Enter a valid amount").optional().nullable(),
  expected_salary: z.string().regex(/^\d{1,8}$/, "Enter a valid amount"),
  reason: z.string().optional().nullable(),
});

export const applicationListQuerySchema = z.object({
  openingId: z.coerce.bigint().optional(),
  status: applicationStatus.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const applicationStatusUpdateSchema = z.object({
  status: applicationStatus,
});
