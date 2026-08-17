import { z } from "zod";

// ─── customer-address (MySQL) schemas ─────────────────────────────────────────
// `stateId` is a numeric FK (accepted as number or numeric string); `city` is a
// plain name string and `label` is a free VARCHAR(20).
const numericId = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/, "Invalid id"),
]);

// 10-digit Indian mobile, no country code / separators. Shared by phone and
// alternatePhone so both columns hold the same normalized shape.
const INDIAN_MOBILE = /^[1-9][0-9]{9}$/;
const MOBILE_MESSAGE = "Enter a valid 10-digit mobile number (no +91 prefix)";

/** Required contact phone. */
const phoneField = z
  .string({ required_error: "Phone is required", invalid_type_error: "Phone is required" })
  .trim()
  .regex(INDIAN_MOBILE, MOBILE_MESSAGE);

/**
 * Optional alternate phone. `""` and `null` both mean "no alternate phone" and
 * are normalized to `null` (the repository writes NULL for it); anything else
 * must be a valid mobile. Omitting the key leaves the stored value untouched on
 * PUT, so the preprocess must NOT turn `undefined` into `null`.
 */
const alternatePhoneField = z
  .preprocess(
    (v) => (v === "" || v === null ? null : typeof v === "string" ? v.trim() : v),
    z.union([z.string().regex(INDIAN_MOBILE, MOBILE_MESSAGE), z.null()])
  )
  .optional();

/** Required email, persisted lowercase. */
const emailField = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z
    .string({ required_error: "Email is required", invalid_type_error: "Email is required" })
    .email("Invalid email")
    .max(100)
);

export const createAddressSchemaMysql = z.object({
  name: z.string().min(1, "Name is required").max(50),
  phone: phoneField,
  alternatePhone: alternatePhoneField,
  email: emailField,
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
