import { z } from "zod";
import { PaymentMethod, PackageCourseEbookPaymentType } from "../../models/enums";

const isObjectIdString = (val: string) => /^[0-9a-fA-F]{24}$/.test(val);
const objectIdSchema = z.string().refine(isObjectIdString, "Invalid id.");

export const placeCourseOrderSchema = z.object({
  courseId: objectIdSchema.optional(),
  packageId: objectIdSchema.optional(),
  planId: objectIdSchema,
  shippingId: objectIdSchema.optional(),
  promocode: z.string().max(50).optional(),
  paymentMethod: z
    .enum([
      PaymentMethod.RAZORPAY,
      PaymentMethod.BANK,
      PaymentMethod.CASH,
      PaymentMethod.FREE,
      PaymentMethod.BACKEND,
    ])
    .default(PaymentMethod.RAZORPAY),
  razorpayOrderId: z.string().max(100).optional(),
  razorpayPaymentId: z.string().max(100).optional(),
}).refine((d) => !!(d.courseId || d.packageId), {
  message: "Provide either courseId or packageId.",
});

export const placeEbookOrderSchema = z.object({
  ebookId: objectIdSchema,
  planId: objectIdSchema,
  promocode: z.string().max(50).optional(),
  paymentMethod: z
    .enum([
      PaymentMethod.RAZORPAY,
      PaymentMethod.BANK,
      PaymentMethod.CASH,
      PaymentMethod.FREE,
      PaymentMethod.BACKEND,
    ])
    .default(PaymentMethod.RAZORPAY),
  razorpayOrderId: z.string().max(100).optional(),
  razorpayPaymentId: z.string().max(100).optional(),
});

export const verifyPaymentSchema = z.object({
  orderType: z.enum(["course", "ebook", "book"]),
  orderId: objectIdSchema,
  razorpayOrderId: z.string().min(1).max(100),
  razorpayPaymentId: z.string().min(1).max(100),
  razorpaySignature: z.string().min(1).max(255).optional(),
});

export { PackageCourseEbookPaymentType };
