import { z } from "zod";
import { PromocodeType } from "../../models/enums";

// Accept a 24-hex Mongo ObjectId OR a positive integer id (the SQL/MySQL branch
// sends int ids). Mirrors how ebook.validation was widened for examCountdown.
const objectIdOrIntRegex = /^(?:[0-9a-fA-F]{24}|[1-9][0-9]*)$/;

const promocodeBase = z.object({
  promocode: z.string().min(1).max(50),
  title: z.string().max(255).optional().default(""),
  description: z.string().max(1000).optional().default(""),
  promo_start_at: z.string().min(1),
  promo_expire_at: z.string().min(1),
  type: z.enum([PromocodeType.PUBLIC, PromocodeType.PRIVATE]).default(PromocodeType.PRIVATE),
  status: z.boolean().optional(),
  discountType: z.enum(["flat", "percentage"]).default("percentage"),
  // Optional: this promocode model is per-plan-percentage based — the effective
  // discount is each plan's customerPercentage, so there is no global discount in
  // the admin UI. Create defaults this to 0 (see createPromocodeSchema); update
  // leaves it untouched when omitted.
  discountValue: z.number().nonnegative("discountValue must be >= 0").optional(),
  promoterId: z.string().regex(objectIdOrIntRegex).nullable().optional(),
});

const validateDiscount = <T extends { discountType?: "flat" | "percentage"; discountValue?: number }>(d: T) =>
  d.discountType !== "percentage" || d.discountValue === undefined || d.discountValue <= 100;
const discountErr = {
  message: "discountValue must be <= 100 when discountType is 'percentage'",
  path: ["discountValue"],
};

export const APPLIES_TO_TYPES = ["package", "course", "liveCourse", "ebook", "testSeries"] as const;
export type AppliesToType = (typeof APPLIES_TO_TYPES)[number];

export const appliesToSchema = z.object({
  type: z.enum(APPLIES_TO_TYPES),
  ids: z
    .array(z.string().regex(objectIdOrIntRegex, "Invalid id"))
    .min(1, "Select at least one item"),
});

const percentage = z
  .number()
  .min(0, "must be >= 0")
  .max(100, "must be <= 100");

// Per-plan promoter/customer split. The full array is the desired set on update
// (replace-semantics); rows whose parent entity isn't in `appliesTo.ids` are
// ignored rather than rejected (see TASK 2 #3).
export const planLinkSchema = z.object({
  // Accept a Mongo ObjectId OR a positive-int id — the MySQL branch returns
  // numeric-string plan ids (e.g. "97", "1166"), same format as appliesTo.ids.
  planId: z.string().regex(objectIdOrIntRegex, "Invalid id"),
  promoterPercentage: percentage.default(0),
  customerPercentage: percentage.default(0),
});

export type PlanLinkInput = z.infer<typeof planLinkSchema>;

export const createPromocodeSchema = promocodeBase
  .extend({
    appliesTo: appliesToSchema,
    plans: z.array(planLinkSchema).optional().default([]),
    // Backend default for the plan-%-based model: persist 0 when the UI omits a
    // global discount (the real discount lives per-plan in customerPercentage).
    discountValue: z.number().nonnegative("discountValue must be >= 0").default(0),
  })
  .refine(validateDiscount, discountErr);

export const updatePromocodeSchema = promocodeBase
  .partial()
  .extend({
    appliesTo: appliesToSchema.optional(),
    plans: z.array(planLinkSchema).optional(),
  })
  .refine(validateDiscount, discountErr);

export const togglePromocodeStatusSchema = z.object({
  status: z.boolean(),
});

export const bulkPromocodeIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export const bulkPromocodeStatusSchema = bulkPromocodeIdsSchema.extend({
  status: z.boolean(),
});
