// Admin subscriptions: Zod schemas for subscription grants/edits and customer addresses.
import { z } from "zod";
import { PaymentMethod } from "../../shared/enums";

// Accepts a numeric id or a legacy 24-hex ObjectId. Coerce first: the FE sends ids
// as JSON numbers, which z.string() would reject.
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
    // Optional: when omitted, the grant is priced by the request's amount and
    // its window computed from durationDays instead of being derived from a plan.
    planId: objectIdSchema.optional(), // PackageCourseEbookPrice _id
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
    // Plan-less grants require this (it drives endAt); with a plan it stays an
    // optional override, else endAt is computed from the plan's duration.
    durationDays: z.number().int().positive().optional(),
    startAt: z.string().optional(),
    customerShippingId: objectIdSchema.optional().nullable(),
    remark: z.string().max(1000).optional(),
    status: z.boolean().optional().default(true),
    // extend=true creates a new row continuing from the customer's existing active
    // subscription for this product; with none it behaves as a fresh grant.
    extend: z.boolean().optional().default(false),
  })
  .refine((d) => !!(d.courseId || d.packageId), {
    message: "Provide either courseId or packageId.",
    path: ["courseId"],
  })
  // Without a plan there is no duration to derive the window from, so the
  // request must supply durationDays explicitly.
  .refine((d) => !!(d.planId || d.durationDays), {
    message: "Provide planId or durationDays.",
    path: ["planId"],
  });

export const updateSubscriptionSchema = z.object({
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  status: z.boolean().optional(),
  customerShippingId: objectIdSchema.nullable().optional(),
  trackingId: z.number().int().nullable().optional(),
  remark: z.string().max(1000).optional(),
  // Payment correction: these live on the linked ws_package_course_order, not the
  // subscription. Only the fields sent are written; keep them declared here since
  // Zod silently strips unknown keys.
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
    .optional(),
  bankTransactionId: z.string().max(191).optional().nullable(),
  razorpayOrderId: z.string().max(191).optional().nullable(),
  razorpayPaymentId: z.string().max(191).optional().nullable(),
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

export const adminCreateAddressSchema = z.object({
  customerId: objectIdSchema,
  name: z.string().min(1).max(50),
  phone: z.string().min(10).max(15).optional().nullable(),
  alternatePhone: z.string().max(15).optional().nullable(),
  email: z.string().email().max(100).optional().nullable(),
  address: z.string().min(1).max(255),
  address2: z.string().max(255).optional().default(""),
  // City is a plain name string stored on ws_customer_address.city (VARCHAR(20)).
  city: z.string().min(1, "City is required").max(20),
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
  city: z.string().min(1, "City is required").max(20).optional(),
  stateId: objectIdSchema.optional().nullable(),
  pincode: z.string().min(4).max(10).optional(),
  label: z.enum(["home", "work", "other"]).optional(),
  status: z.boolean().optional(),
});

export const positiveIdSchema = z.coerce.number().int().positive("Invalid id.");

// Optional on every history action — each one already writes its own audit line
// ("Deactivated: end date … -> …"); the admin note is only appended when given.
export const historyRemarkSchema = z.string().trim().max(500).optional();

export const subscriptionIdParamsSchema = z.object({ id: positiveIdSchema });

export const subscriptionRowParamsSchema = z.object({ subscriptionId: positiveIdSchema });

export const changeSubscriptionProductSchema = z
  .object({
    courseId: positiveIdSchema.optional(),
    packageId: positiveIdSchema.optional(),
    remark: historyRemarkSchema,
    confirmDates: z.boolean().optional(),
  })
  .refine((d) => !!d.courseId !== !!d.packageId, {
    message: "Provide exactly one of courseId or packageId.",
    path: ["courseId"],
  });

export const moveSubscriptionSchema = z.object({
  customerId: positiveIdSchema,
  remark: z.string().trim().max(500).optional(),
  confirmDates: z.boolean().optional(),
});

export const deactivateSubscriptionSchema = z.object({
  remark: historyRemarkSchema,
});

export const addDaysSchema = z.object({
  days: z.coerce.number().int().positive("Days must be a positive whole number."),
  remark: historyRemarkSchema,
});

export const revertDeactivationSchema = z.object({
  remark: historyRemarkSchema,
});
