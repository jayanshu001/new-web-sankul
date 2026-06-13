import { z } from "zod";
import { PromocodeType } from "../../models/enums";

const promocodeBase = z.object({
  promocode: z.string().min(1).max(50),
  title: z.string().max(255).optional().default(""),
  description: z.string().max(1000).optional().default(""),
  promo_start_at: z.string().min(1),
  promo_expire_at: z.string().min(1),
  type: z.enum([PromocodeType.PUBLIC, PromocodeType.PRIVATE]).default(PromocodeType.PRIVATE),
  status: z.boolean().optional(),
  discountType: z.enum(["flat", "percentage"]).default("percentage"),
  discountValue: z.number().nonnegative("discountValue must be >= 0"),
  promoterId: z.string().regex(/^[0-9a-fA-F]{24}$/).nullable().optional(),
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
    .array(z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id"))
    .min(1, "Select at least one item"),
});

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");
const percentage = z
  .number()
  .min(0, "must be >= 0")
  .max(100, "must be <= 100");

// Per-plan promoter/customer split. The full array is the desired set on update
// (replace-semantics); rows whose parent entity isn't in `appliesTo.ids` are
// ignored rather than rejected (see TASK 2 #3).
export const planLinkSchema = z.object({
  planId: objectId,
  promoterPercentage: percentage.default(0),
  customerPercentage: percentage.default(0),
});

export type PlanLinkInput = z.infer<typeof planLinkSchema>;

export const createPromocodeSchema = promocodeBase
  .extend({
    appliesTo: appliesToSchema,
    plans: z.array(planLinkSchema).optional().default([]),
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
