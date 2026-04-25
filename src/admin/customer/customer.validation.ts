import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createCustomerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  middleName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  phoneNumber: z.string().min(10).max(11),
  phone2: z.string().max(11).optional().nullable(),
  emailAddress: z.string().email().optional().nullable(),
  dob: z.string().optional().nullable(),
  gender: z.string().max(10).optional().nullable(),
  stateId: z.string().regex(objectIdRegex, "Invalid stateId").optional().nullable(),
  districtId: z.string().regex(objectIdRegex, "Invalid districtId").optional().nullable(),
  city: z.string().max(255).optional().nullable(),
  educationId: z.string().regex(objectIdRegex, "Invalid educationId").optional().nullable(),
  language: z.string().max(50).optional().nullable(),
  goals: z.array(z.string().regex(objectIdRegex)).optional().default([]),
  profilePicture: z.string().max(500).optional().nullable(),
  status: z.coerce.boolean().optional().default(true),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const updateSubscriptionDatesSchema = z.object({
  endAt: z.string().min(1, "endAt is required"),
  remarks: z.string().optional().nullable(),
});
