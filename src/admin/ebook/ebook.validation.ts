import { z } from "zod";
import { EBookLanguage, PackageCourseEbookOrderStatus, PackageCourseEbookPaymentType, PaymentMethod } from "../../shared/enums";

const objectIdRegex = /^([0-9a-fA-F]{24}|[1-9]\d*)$/;
// On the SQL (MySQL) branch the attached countdown/category ids are numeric
// strings, not 24-hex ObjectIds. Accept either form for the id-ARRAY fields so
// the SQL write isn't rejected at validation; the service coerces via
// parseIdArray (ints) on SQL and stores ObjectId strings on Mongo. Keeps the
// strict single legacy `examCountdownCategoryId` (Mongo-only writer) untouched.
const objectIdOrIntRegex = /^(?:[0-9a-fA-F]{24}|[1-9][0-9]*)$/;

const zBool = z.preprocess(
  (v) => (typeof v === "string" ? v === "true" : v),
  z.boolean()
);

// Accepts an array of ids, a single id string, or a JSON-stringified array
// (multipart form-data flattens arrays — the controller also reassembles the
// bracketed `field[]` keys before this runs), and normalizes to string[].
// Empty string / empty array clears the links; each entry must be an ObjectId.
const zObjectIdArray = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.filter((s) => s !== "");
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return [];
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        return Array.isArray(parsed) ? parsed.filter((x) => x !== "") : [s];
      } catch {
        return [s];
      }
    }
    return [s];
  }
  return v;
}, z.array(z.string().regex(objectIdOrIntRegex, "Invalid id")));

export const createEbookSchema = z.object({
  name: z.string().min(1, "Name is required"),
  examCountdownCategoryId: z.preprocess(
    (v) => (v === "" || v === "null" ? null : v),
    z.string().regex(objectIdRegex, "Invalid examCountdownCategoryId").nullable().optional()
  ),
  examCountdownCategoryIds: zObjectIdArray.optional(),
  examCountdownIds: zObjectIdArray.optional(),
  description: z.string().min(1, "Description is required"),
  author: z.string().min(1, "Author is required"),
  publisher: z.string().min(1, "Publisher is required"),
  language: z.enum(Object.values(EBookLanguage) as [string, ...string[]]),
  order: z.coerce.number().int().nonnegative().optional().default(0),
  image: z.string().optional().nullable(),
  thumbnail: z.string().optional().nullable(),
  demoUrl: z.preprocess((v) => (v === "" ? null : v), z.string().optional().nullable()),
  bookUrl: z.preprocess((v) => (v === "" ? null : v), z.string().optional().nullable()),
  demoFileName: z.preprocess((v) => (v === "" ? null : v), z.string().optional().nullable()),
  bookFileName: z.preprocess((v) => (v === "" ? null : v), z.string().optional().nullable()),
  link: z.string().min(1, "Link is required"),
  termsAndConditions: z.string().optional().nullable(),
  isTrending: zBool.optional().default(false),
  isPaid: zBool.optional().default(true),
  status: zBool.optional().default(true),
});

export const updateEbookSchema = createEbookSchema.partial();

export const createEbookPlanSchema = z.object({
  name: z.string().optional().nullable(),
  duration: z.number().int().positive("Duration must be a positive integer"),
  price: z.number().nonnegative("Price must be non-negative"),
  isDefault: zBool.optional().default(false),
  status: zBool.optional().default(true),
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

// All fields optional so the endpoint can serve both flows:
//  - verify a pending order  → send razorpayOrderId + razorpayPaymentId
//  - toggle the subscription → send just { status }
// The controller decides which path to run based on which fields are present.
export const updateEbookSubscriptionSchema = z.object({
  razorpayOrderId: z.string().min(1, "razorpayOrderId is required").optional(),
  razorpayPaymentId: z.string().min(1, "razorpayPaymentId is required").optional(),
  remarks: z.string().optional().nullable(),
  status: zBool.optional(),
});

export const reorderEbooksSchema = z.object({
  orders: z.array(
    z.object({
      id: z.string().regex(objectIdRegex, "Invalid ebook ID"),
      order: z.number().int().nonnegative(),
    })
  ).min(1, "orders array must not be empty"),
});

// SQL branch: ids are numeric (the Mongo schema enforces ObjectId). Same shape.
export const reorderEbooksSqlSchema = z.object({
  orders: z.array(
    z.object({
      id: z.coerce.string().min(1, "Invalid ebook ID"),
      order: z.coerce.number().int().nonnegative(),
    })
  ).min(1, "orders array must not be empty"),
});

// SQL-side subscription create (numeric ids; the Mongo schema enforces ObjectId).
// The standardized Add-Subscription form sends `amount` / `bankTransactionId` /
// `durationDays`; the original SQL contract used `orderPrice` / `transactionId` /
// `durationInDays`. Both are accepted and coalesced to the canonical keys so
// existing callers keep working while the form needs no change.
export const createEbookSubscriptionSqlSchema = z
  .object({
    customerId: z.coerce.number().int().positive(),
    ebookId: z.coerce.number().int().positive(),
    planId: z.coerce.number().int().positive().optional().nullable(),
    durationInDays: z.coerce.number().int().positive().optional(),
    durationDays: z.coerce.number().int().positive().optional(), // Add-Subscription alias
    paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
    orderPrice: z.coerce.number().nonnegative().optional(),
    amount: z.coerce.number().nonnegative().optional(), // Add-Subscription alias
    razorpayOrderId: z.string().optional().nullable(),
    razorpayPaymentId: z.string().optional().nullable(),
    transactionId: z.string().optional().nullable(),
    bankTransactionId: z.string().optional().nullable(), // Add-Subscription alias
    remarks: z.string().optional().nullable(),
    status: z.boolean().optional().default(true),
    // Subscription Type = Extend: top up the existing sub instead of a fresh row.
    extend: z.boolean().optional(),
  })
  .transform((d) => ({
    ...d,
    orderPrice: d.orderPrice ?? d.amount,
    durationInDays: d.durationInDays ?? d.durationDays,
    transactionId: d.transactionId ?? d.bankTransactionId ?? null,
  }))
  .refine((d) => d.orderPrice != null, { message: "amount is required", path: ["amount"] })
  .refine((d) => d.planId || d.durationInDays, { message: "Either planId or durationInDays is required", path: ["planId"] });
