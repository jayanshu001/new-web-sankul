import { z } from "zod";
import { EBookLanguage, PackageCourseEbookOrderStatus, PackageCourseEbookPaymentType, PaymentMethod } from "../../models/enums";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createEbookSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  author: z.string().min(1, "Author is required"),
  publisher: z.string().min(1, "Publisher is required"),
  language: z.enum(Object.values(EBookLanguage) as [string, ...string[]]),
  order: z.number().int().nonnegative().optional().default(0),
  image: z.string().optional().nullable(),
  thumbnail: z.string().optional().nullable(),
  demoUrl: z.string().optional().nullable(),
  bookUrl: z.string().optional().nullable(),
  link: z.string().min(1, "Link is required"),
  termsAndConditions: z.string().optional().nullable(),
  isTrending: z.boolean().optional().default(false),
  status: z.boolean().optional().default(true),
});

export const updateEbookSchema = createEbookSchema.partial();

export const createEbookPlanSchema = z.object({
  name: z.string().optional().nullable(),
  duration: z.number().int().positive("Duration must be a positive integer"),
  price: z.number().nonnegative("Price must be non-negative"),
  withMaterial: z.boolean().optional().default(false),
  materialPrice: z.number().nonnegative().optional().default(0),
  isDefault: z.boolean().optional().default(false),
  status: z.boolean().optional().default(true),
});

export const updateEbookPlanSchema = createEbookPlanSchema.partial();

export const createEbookSubscriptionSchema = z.object({
  customerId: z.string().regex(objectIdRegex, "Invalid customerId"),
  ebookId: z.string().regex(objectIdRegex, "Invalid ebookId"),
  planId: z.string().regex(objectIdRegex, "Invalid planId").optional().nullable(),
  durationInDays: z.number().int().positive().optional(),
  paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
  orderPrice: z.number().nonnegative(),
  razorpayOrderId: z.string().optional().nullable(),
  razorpayPaymentId: z.string().optional().nullable(),
  transactionId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  status: z.boolean().optional().default(true),
}).refine(
  (data) => data.planId || data.durationInDays,
  { message: "Either planId or durationInDays is required", path: ["planId"] }
);

export const updateEbookSubscriptionSchema = z.object({
  razorpayOrderId: z.string().min(1, "razorpayOrderId is required"),
  razorpayPaymentId: z.string().min(1, "razorpayPaymentId is required"),
  remarks: z.string().optional().nullable(),
});

export const reorderEbooksSchema = z.object({
  orders: z.array(
    z.object({
      id: z.string().regex(objectIdRegex, "Invalid ebook ID"),
      order: z.number().int().nonnegative(),
    })
  ).min(1, "orders array must not be empty"),
});
