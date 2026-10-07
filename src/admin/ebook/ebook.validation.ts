// Admin ebooks: Zod request schemas.
import { z } from "zod";
import { EBookLanguage, PaymentMethod } from "../../shared/enums";

const objectIdRegex = /^([0-9a-fA-F]{24}|[1-9]\d*)$/;
const objectIdOrIntRegex = /^(?:[0-9a-fA-F]{24}|[1-9][0-9]*)$/;

const zBool = z.preprocess(
  (v) => (typeof v === "string" ? v === "true" : v),
  z.boolean()
);

// Accepts an array, a single id string, or a JSON-stringified array (multipart
// flattens arrays; the controller reassembles bracketed `field[]` keys first).
// Empty string / empty array clears the links.
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
  order: z.coerce.number().int().optional().default(0),
  image: z.string().optional().nullable(),
  thumbnail: z.string().optional().nullable(),
  demoUrl: z.preprocess((v) => (v === "" ? null : v), z.string().optional().nullable()),
  bookUrl: z.preprocess((v) => (v === "" ? null : v), z.string().optional().nullable()),
  demoFileName: z.preprocess((v) => (v === "" ? null : v), z.string().optional().nullable()),
  bookFileName: z.preprocess((v) => (v === "" ? null : v), z.string().optional().nullable()),
  // "" clears the link (stored as "" since ws_ebook.link is NOT NULL). No URL
  // check here; the frontend validates non-empty values.
  link: z.string().optional().nullable(),
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

// Serves two flows, chosen by which fields are present: verify a pending order
// (razorpayOrderId + razorpayPaymentId) or toggle the subscription ({ status }).
export const updateEbookSubscriptionSchema = z.object({
  razorpayOrderId: z.string().min(1, "razorpayOrderId is required").optional(),
  razorpayPaymentId: z.string().min(1, "razorpayPaymentId is required").optional(),
  remarks: z.string().optional().nullable(),
  status: zBool.optional(),
  // z.object() strips unknown keys, so omitting these silently drops admin date edits.
  startAt: z.string().optional(),
  endAt: z.string().optional(),
});

export const reorderEbooksSqlSchema = z.object({
  orders: z.array(
    z.object({
      id: z.coerce.string().min(1, "Invalid ebook ID"),
      order: z.coerce.number().int().nonnegative(),
    })
  ).min(1, "orders array must not be empty"),
});

// The Add-Subscription form sends amount / bankTransactionId / durationDays;
// older callers send orderPrice / transactionId / durationInDays. Both are
// accepted and coalesced to the latter.
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
    // Subscription Type = Extend.

    extend: z.boolean().optional(),
  })
  .transform((d) => ({
    ...d,
    orderPrice: d.orderPrice ?? d.amount,
    durationInDays: d.durationInDays ?? d.durationDays,
    transactionId: d.transactionId ?? d.bankTransactionId ?? null,
  }))
  // A free "Add Days" extend sends no amount on purpose: 0 would zero the
  // subscription's stored price and the original price would fabricate revenue.
  // Still required for a fresh grant, where the row's price has no prior value.
  .refine((d) => d.extend === true || d.orderPrice != null, { message: "amount is required", path: ["amount"] })
  .refine((d) => d.planId || d.durationInDays, { message: "Either planId or durationInDays is required", path: ["planId"] });
