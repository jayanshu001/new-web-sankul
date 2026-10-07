// Client courses: Zod schemas for order shipping and lecture queries.
import { z } from "zod";

export const objectIdRegex = /^([0-9a-fA-F]{24}|[1-9]\d*)$/;
// Accepts legacy 24-hex ids as well as numeric ids.
export const idOrObjectIdRegex = /^([0-9a-fA-F]{24}|\d+)$/;

const phoneSchema = z
  .union([z.string(), z.number()])
  .refine((v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 1000000000 && n <= 99999999999;
  }, "Phone number must be 10-11 digits");

const pincodeSchema = z
  .union([z.string(), z.number()])
  .refine((v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isInteger(n) && n >= 100000 && n <= 999999;
  }, "Pincode must be 6 digits");

// Field names keep the snake_case API contract.
const NAME_RE = /^[A-Za-z ]+$/;
const ADDRESS_RE = /^[A-Za-z0-9 ,.\-\/#]+$/;
const CITY_RE = /^[A-Za-z0-9 ]+$/;

export const shippingBodySchema = z.object({
  name: z.string().regex(NAME_RE, "Name is invalid"),
  phone: phoneSchema,
  alternate_phone: phoneSchema.nullable().optional(),
  email: z.string().email("Email is invalid").nullable().optional(),
  address: z.string().regex(ADDRESS_RE, "Address is invalid"),
  address_2: z.string().regex(ADDRESS_RE, "Address line 2 is invalid"),
  city: z.string().regex(CITY_RE, "City is invalid"),
  state: z
    .string()
    .regex(objectIdRegex, "Invalid state")
    .nullable()
    .optional(),
  pincode: pincodeSchema,
});

export type ShippingBody = z.infer<typeof shippingBodySchema>;

export const lectureQuerySchema = z.object({
  id: z.string().regex(idOrObjectIdRegex, "Invalid video ID"),
  course: z.string().regex(idOrObjectIdRegex, "Invalid course ID").optional(),
  package: z.string().regex(idOrObjectIdRegex, "Invalid package ID").optional(),
  type: z.enum(["course", "package"]),
});
