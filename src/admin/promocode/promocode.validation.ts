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
  // Legacy global discount. The admin panel moved to a per-plan percentage
  // model (see `plans[].customerPercentage`), so these are now OPTIONAL — the FE
  // no longer sends them for new item-specific codes. Kept (defaulted) for
  // backward compatibility with legacy codes that still carry a global discount.
  discountType: z.enum(["flat", "percentage"]).default("percentage"),
  discountValue: z.number().nonnegative("discountValue must be >= 0").optional().default(0),
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

// Per-plan customerPercentage is now the real checkout discount, so at least one
// plan must carry a positive customer % (0 < x <= 100). Codes with no positive
// customer % would silently discount nothing.
const hasPositiveCustomerPct = (plans?: Array<{ customerPercentage?: number }>) =>
  Array.isArray(plans) && plans.some((p) => (p.customerPercentage ?? 0) > 0);
const positivePctErr = {
  message: "At least one plan must have a customerPercentage greater than 0 (and <= 100).",
  path: ["plans"],
};

export const createPromocodeSchema = promocodeBase
  .extend({
    appliesTo: appliesToSchema,
    plans: z.array(planLinkSchema).optional().default([]),
  })
  .refine(validateDiscount, discountErr)
  .refine((d) => hasPositiveCustomerPct(d.plans), positivePctErr);

export const updatePromocodeSchema = promocodeBase
  .partial()
  .extend({
    appliesTo: appliesToSchema.optional(),
    plans: z.array(planLinkSchema).optional(),
  })
  .refine(validateDiscount, discountErr)
  // On update, only enforce the positive-% rule when `plans` is actually being
  // changed (present). A partial update that doesn't touch plans is left alone.
  .refine((d) => d.plans === undefined || hasPositiveCustomerPct(d.plans), positivePctErr);

export const togglePromocodeStatusSchema = z.object({
  status: z.boolean(),
});

export const bulkPromocodeIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export const bulkPromocodeStatusSchema = bulkPromocodeIdsSchema.extend({
  status: z.boolean(),
});
