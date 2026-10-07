// Promocodes: entity coverage and discount math shared by checkout flows.
export type PromoAppliesToType =
  | "package"
  | "course"
  | "liveCourse"
  | "ebook"
  | "testSeries";

// Accepts both hydrated promo objects and SQL rows.
interface PromoCoversInput {
  appliesTo?: {
    type: PromoAppliesToType;
    ids: Array<string | number>;
  } | null;
}

interface PromoDiscountInput {
  discountType: "flat" | "percentage";
  discountValue: number;
}

// Truth source is `promo.appliesTo`.
export function promoCovers(
  promo: PromoCoversInput,
  context: { type: PromoAppliesToType; id: string | number }
): boolean {
  const at = promo.appliesTo;
  if (!at || !at.type || !at.ids?.length) return false;
  if (at.type !== context.type) return false;
  const target = String(context.id);
  return at.ids.some((id) => String(id) === target);
}

// Clamped to [0, baseAmount] so the result is never negative or larger than the base.
export function computePromoDiscount(
  promo: PromoDiscountInput,
  baseAmount: number
): number {
  const value = Number(promo.discountValue ?? 0);
  if (!(value > 0) || !(baseAmount > 0)) return 0;
  const raw =
    promo.discountType === "percentage"
      ? Math.round((baseAmount * value) / 100)
      : Math.round(value);
  return Math.min(baseAmount, Math.max(0, raw));
}

// Per-plan discount: a plan's `customerPercentage` from its PromotedPackageCourseEbook
// link row, applied to the plan's own price. Codes created before the per-plan UI have
// no link rows and fall back to the top-level discountType/discountValue (agreed with FE).

export interface PerPlanDiscount {
  // Already clamped to [0, basePrice].
  amount: number;
  // Per-plan %, or legacy % (null when the legacy discount is flat).
  appliedPercentage: number | null;
  // Promoter commission % for this plan (0 for legacy/uncovered plans); recorded at purchase.
  promoterPercentage: number;
  source: "per-plan" | "legacy";
}

export interface PlanLinkPercentages {
  customerPercentage: number;
  promoterPercentage: number;
}
