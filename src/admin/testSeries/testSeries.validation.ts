import { z } from "zod";
import { ExamLanguage, PaymentMethod } from "../../shared/enums";

// During the Mongo→SQL migration window an id may be either a 24-hex Mongo
// ObjectId OR a positive integer (SQL autoincrement id, sent as a string by
// multipart/JSON clients). Accept both so neither backend rejects valid ids.
const objectId = z
  .union([
    z.string().regex(/^([0-9a-fA-F]{24}|[1-9]\d*)$/),
    z.string().regex(/^[1-9][0-9]*$/),
  ])
  .or(z.number().int().positive().transform(String));

// Coerce: multipart/form-data delivers everything as strings, so we accept
// strings and convert. JSON callers can still send native types.
const boolish = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1" || v === 1) return true;
  if (v === "false" || v === "0" || v === 0) return false;
  return v;
}, z.boolean());

const intish = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z.number().int()
);

const numish = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z.number()
);

// Array of ObjectIds tolerant of every transport shape:
//   - JSON body:            ["id1","id2"]            (real array)
//   - multipart repeated:   examCategoryIds=id1&...  (multer → array, or single string)
//   - JSON-encoded string:  '["id1","id2"]'          (some form clients)
// The bracket-suffixed `examCategoryIds[]` key is normalized to `examCategoryIds`
// in the controller before this runs.
const objectIdArray = z.preprocess((v) => {
  if (v == null || v === "") return undefined;
  if (Array.isArray(v)) return v.filter((x) => x != null && x !== "");
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.filter((x) => x != null && x !== "");
      } catch {
        /* fall through to single-value wrap */
      }
    }
    return [s];
  }
  return v;
}, z.array(objectId));

// ─── Test Series ─────────────────────────────────────────────────────────────

export const createTestSeriesSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().optional(),
  thumbnail: z.string().trim().max(500).optional(),
  examCategoryIds: objectIdArray.optional(),
  // @deprecated — still accepted from old clients; folded into examCategoryIds in the controller.
  examCategoryId: objectId.optional().nullable(),
  language: z.enum(Object.values(ExamLanguage) as [string, ...string[]]).optional(),
  isFree: boolish.optional(),
  instructions: z.string().optional(),
  policy: z.string().optional(),
  orderBy: intish.optional(),
  status: boolish.optional(),
});

export const updateTestSeriesSchema = createTestSeriesSchema.partial();

// ─── Content Category (series-scoped) ────────────────────────────────────────

export const createContentCategorySchema = z.object({
  name: z.string().trim().min(1).max(255),
  icon: z.string().trim().max(500).optional(),
  orderBy: intish.optional(),
  status: boolish.optional(),
});

export const updateContentCategorySchema = createContentCategorySchema.partial();

// ─── Series ↔ Exam link ──────────────────────────────────────────────────────

export const linkExamSchema = z.object({
  contentCategoryId: objectId,
  examId: objectId,
  orderBy: intish.optional(),
  status: boolish.optional(),
});

export const updateLinkSchema = z.object({
  contentCategoryId: objectId.optional(),
  orderBy: intish.optional(),
  status: boolish.optional(),
});

// ─── Price plan ──────────────────────────────────────────────────────────────

export const createPriceSchema = z.object({
  name: z.string().trim().max(200).optional(),
  durationDays: intish.refine((v) => Number(v) > 0, "durationDays must be positive"),
  price: numish.refine((v) => Number(v) >= 0, "price must be >= 0"),
  originalPrice: numish.refine((v) => Number(v) >= 0).optional(),
  isDefault: boolish.optional(),
  status: boolish.optional(),
});

export const updatePriceSchema = createPriceSchema.partial();

// ─── Subscription grant / edit ───────────────────────────────────────────────

export const grantSubscriptionSchema = z.object({
  customerId: objectId,
  planId: objectId.optional(),
  durationDays: intish.optional(),
  price: numish.optional(),
  startAt: z.string().optional(),
  remarks: z.string().optional(),
  // Standardized payment section: method + reference ids recorded on the linked
  // ws_test_series_order row. Ref ids arrive only for their method.
  paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]).optional(),
  bankTransactionId: z.string().optional().nullable(),
  razorpayOrderId: z.string().optional().nullable(),
  razorpayPaymentId: z.string().optional().nullable(),
  // Subscription Type = Extend: top up the existing sub instead of a fresh row.
  extend: boolish.optional(),
});

export const updateSubscriptionSchema = z.object({
  endAt: z.string().optional(),
  status: boolish.optional(),
  remarks: z.string().optional(),
});
