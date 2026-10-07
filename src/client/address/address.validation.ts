// Client addresses: Zod request schemas.
import { z } from "zod";

// `stateId` is a numeric FK (number or numeric string); `city` is a plain name string;
// `label` is a free VARCHAR(20).
const numericId = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/, "Invalid id"),
]);

// 10-digit Indian mobile, no country code or separators; shared by phone and alternatePhone.
const INDIAN_MOBILE = /^[1-9][0-9]{9}$/;
const MOBILE_MESSAGE = "Enter a valid 10-digit mobile number (no +91 prefix)";

const phoneField = z
  .string({ required_error: "Phone is required", invalid_type_error: "Phone is required" })
  .trim()
  .regex(INDIAN_MOBILE, MOBILE_MESSAGE);

/**
 * `""` and `null` both normalize to `null`. Omitting the key leaves the stored value
 * untouched on PUT, so the preprocess must not turn `undefined` into `null`.
 */
const alternatePhoneField = z
  .preprocess(
    (v) => (v === "" || v === null ? null : typeof v === "string" ? v.trim() : v),
    z.union([z.string().regex(INDIAN_MOBILE, MOBILE_MESSAGE), z.null()])
  )
  .optional();

/** Persisted lowercase. */
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
  // City name stored on ws_customer_address.city (VARCHAR(20)); there is no city id.
  city: z.string().min(1, "City is required").max(20),
  stateId: numericId.optional().nullable(),
  pincode: z.string().min(4).max(10),
  label: z.string().max(20).optional().nullable(),
  status: z.boolean().optional().default(true),
});

export const updateAddressSchemaMysql = createAddressSchemaMysql.partial();
