import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createAddressSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  phone: z.string().min(10).max(15).optional().nullable(),
  alternatePhone: z.string().max(15).optional().nullable(),
  email: z.string().email("Invalid email").max(100).optional().nullable(),
  address: z.string().min(1, "Address is required").max(255),
  address2: z.string().max(255).optional().default(""),
  cityId: z.string().regex(objectIdRegex, "Invalid cityId"),
  stateId: z.string().regex(objectIdRegex, "Invalid stateId").optional().nullable(),
  pincode: z.string().min(4).max(10),
  label: z.enum(["home", "work", "other"]).optional().default("home"),
  status: z.boolean().optional().default(true),
});

export const updateAddressSchema = createAddressSchema.partial();

// ─── MySQL (customer-address) variants ────────────────────────────────────────
// MySQL FKs are integers, not ObjectIds: `cityId`/`stateId` are numeric ids
// (accepted as number or numeric string) and `label` is a free VARCHAR(20).
const numericId = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/, "Invalid id"),
]);

export const createAddressSchemaMysql = z.object({
  name: z.string().min(1, "Name is required").max(50),
  phone: z.string().min(10).max(15).optional().nullable(),
  alternatePhone: z.string().max(15).optional().nullable(),
  email: z.string().email("Invalid email").max(100).optional().nullable(),
  address: z.string().min(1, "Address is required").max(255),
  address2: z.string().max(255).optional().default(""),
  city: z.string().min(1, "City is required").max(20),
  cityId: numericId.optional().nullable(),
  stateId: numericId.optional().nullable(),
  pincode: z.string().min(4).max(10),
  label: z.string().max(20).optional().nullable(),
  status: z.boolean().optional().default(true),
});

export const updateAddressSchemaMysql = createAddressSchemaMysql.partial();
