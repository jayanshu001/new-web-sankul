import { z } from "zod";
import { PaymentMethod } from "../../shared/enums";

// Accept either a Mongo ObjectId (24-hex) OR a MySQL numeric id, so the same
// validation works on MySQL where ids are integers. Coerce first: the FE sends
// MySQL ids as JSON numbers, so without coercion z.string() rejects them.
// Mirrors the dual-id handling in video.validation.ts.
const objectIdSchema = z.coerce.string().refine(
  (v) => /^[0-9a-fA-F]{24}$/.test(v) || /^[1-9]\d*$/.test(v),
  { message: "Invalid id." }
);

export const createSubscriptionSchema = z
  .object({
    customerId: objectIdSchema,
    // Exactly one of these two must be provided:
    courseId: objectIdSchema.optional(),
    packageId: objectIdSchema.optional(), // the target Package _id (not the plan row)
    planId: objectIdSchema, // PackageCourseEbookPrice _id
    withMaterial: z.boolean().optional().default(false),
    paymentMethod: z
      .enum([
        PaymentMethod.BACKEND,
        PaymentMethod.RAZORPAY,
        PaymentMethod.BANK,
        PaymentMethod.CASH,
        PaymentMethod.FREE,
        PaymentMethod.PAYKUN,
        PaymentMethod.PAYTM,
      ])
      .default(PaymentMethod.CASH),
    amount: z.number().nonnegative().optional(),
    // Standardized payment section: reference ids arrive only for their method
    // (bank → bankTransactionId; razorpay → the two ids), else absent.
    bankTransactionId: z.string().max(191).optional().nullable(),
    razorpayOrderId: z.string().max(191).optional().nullable(),
    razorpayPaymentId: z.string().max(191).optional().nullable(),
    // Optional override; if omitted, endAt is computed from the plan's
    // duration (months) per project convention.
    durationDays: z.number().int().positive().optional(),
    startAt: z.string().optional(),
    customerShippingId: objectIdSchema.optional().nullable(),
    remark: z.string().max(1000).optional(),
    status: z.boolean().optional().default(true),
    // Subscription Type control: extend=true tops up the customer's existing
    // subscription for this product (append plan duration onto endAt) instead of
    // creating a fresh row. No existing sub → falls back to a fresh create.
    extend: z.boolean().optional().default(false),
  })
  .refine((d) => !!(d.courseId || d.packageId), {
    message: "Provide either courseId or packageId.",
    path: ["courseId"],
  });

export const updateSubscriptionSchema = z.object({
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  status: z.boolean().optional(),
  customerShippingId: objectIdSchema.nullable().optional(),
  trackingId: z.number().int().nullable().optional(),
  remark: z.string().max(1000).optional(),
});

export const createEbookSubscriptionSchema = z.object({
  customerId: objectIdSchema,
  ebookId: objectIdSchema,
  price: z.number().int().nonnegative(),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  paymentType: z.enum(["backend", "online"]).default("backend"),
  remarks: z.string().max(1000).optional(),
});

// Admin creates an address on behalf of a customer
export const adminCreateAddressSchema = z.object({
  customerId: objectIdSchema,
  name: z.string().min(1).max(50),
  phone: z.string().min(10).max(15).optional().nullable(),
  alternatePhone: z.string().max(15).optional().nullable(),
  email: z.string().email().max(100).optional().nullable(),
  address: z.string().min(1).max(255),
  address2: z.string().max(255).optional().default(""),
  cityId: objectIdSchema.optional().nullable(),
  stateId: objectIdSchema.optional().nullable(),
  pincode: z.string().min(4).max(10),
  label: z.enum(["home", "work", "other"]).optional().default("home"),
  status: z.boolean().optional().default(true),
});

// Admin edits an existing address. customerId scopes the update to its owner;
// every other field is optional (partial update).
export const adminUpdateAddressSchema = z.object({
  customerId: objectIdSchema,
  name: z.string().min(1).max(50).optional(),
  phone: z.string().min(10).max(15).optional().nullable(),
  alternatePhone: z.string().max(15).optional().nullable(),
  email: z.string().email().max(100).optional().nullable(),
  address: z.string().min(1).max(255).optional(),
  address2: z.string().max(255).optional(),
  cityId: objectIdSchema.optional().nullable(),
  stateId: objectIdSchema.optional().nullable(),
  pincode: z.string().min(4).max(10).optional(),
  label: z.enum(["home", "work", "other"]).optional(),
  status: z.boolean().optional(),
});
