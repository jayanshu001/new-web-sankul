import { z } from "zod";
import { PaymentMethod } from "../../models/enums";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id.");

export const createSubscriptionSchema = z.object({
  customerId: objectIdSchema,
  courseId: objectIdSchema.optional(),
  packageId: objectIdSchema.optional(),
  planId: objectIdSchema,
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  paymentMethod: z
    .enum([
      PaymentMethod.BACKEND,
      PaymentMethod.RAZORPAY,
      PaymentMethod.BANK,
      PaymentMethod.CASH,
      PaymentMethod.FREE,
    ])
    .default(PaymentMethod.BACKEND),
  customerShippingId: objectIdSchema.optional(),
  remarks: z.string().max(1000).optional(),
}).refine((d) => !!(d.courseId || d.packageId), {
  message: "Provide either courseId or packageId.",
});

export const updateSubscriptionSchema = z.object({
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  status: z.boolean().optional(),
  customerShippingId: objectIdSchema.nullable().optional(),
  trackingId: z.number().int().nullable().optional(),
  remarks: z.string().max(1000).optional(),
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
