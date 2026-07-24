import { z } from "zod";

// ─── customer-address (MySQL) schemas ─────────────────────────────────────────
// `stateId` is a numeric FK (accepted as number or numeric string); `city` is a
// plain name string and `label` is a free VARCHAR(20).
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
  // `city` is the city NAME stored on ws_customer_address.city (VARCHAR(20)).
  // Sent directly by the client as a string — there is no city id reference.
  city: z.string().min(1, "City is required").max(20),
  stateId: numericId.optional().nullable(),
  pincode: z.string().min(4).max(10),
  label: z.string().max(20).optional().nullable(),
  status: z.boolean().optional().default(true),
});

export const updateAddressSchemaMysql = createAddressSchemaMysql.partial();
