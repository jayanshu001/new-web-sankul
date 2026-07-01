// The entity kinds a promo code can apply to. Previously sourced from the Mongo
// PromoCode model; now defined here (the canonical home) since the promo-applies
// logic lives in this module and Mongo is retired.
export type PromoAppliesToType =
  | "package"
  | "course"
  | "liveCourse"
  | "ebook"
  | "testSeries";

// Shape we actually need — accepts both hydrated promo docs and lean/SQL rows,
// so callers don't have to pick one path.
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

// Given a promocode and the cart context (entity type + id), decide whether the
// code applies. Truth source is `promo.appliesTo` populated by the new admin UI.
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

// Compute the discount amount from the promocode's discount fields.
// Truncates to [0, baseAmount] so we never go negative or hand out free money.
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

// ─── Per-plan discount resolution ──────────────────────────────────────────────
//
// New model: the real discount for a plan comes from that plan's per-plan
// `customerPercentage` (stored in the PromotedPackageCourseEbook link table),
// applied as a percentage off the plan's own price.
//
// Legacy fallback: codes created before the per-plan UI have no link rows, only
// a top-level discountType/discountValue. For those plans we fall back to the
// global discount via computePromoDiscount().
//
// Net rule (agreed with FE):
//   discount(plan) = per-plan customerPercentage if a link row exists,
//                    else legacy top-level discountValue/discountType.

export interface PerPlanDiscount {
  // Discount amount in currency, already truncated to [0, basePrice].
  amount: number;
  // The percentage actually applied (per-plan %, or legacy % when flat→null).
  appliedPercentage: number | null;
  // The promoter's commission percentage for this plan (per-plan link row, or 0
  // for legacy/uncovered plans). Used to record promoter earnings at purchase.
  promoterPercentage: number;
  // Where the discount came from — useful for QA / logging the fallback branch.
  source: "per-plan" | "legacy";
}

// Per-plan link values needed at resolution time: both the customer discount
// and the promoter's commission cut.
export interface PlanLinkPercentages {
  customerPercentage: number;
  promoterPercentage: number;
}

/**
 * Resolve the discount for a single plan given its base price and the per-plan
 * map (keyed by stringified planId, loaded by the SQL promo-code service). Falls
 * back to the legacy global discount when the plan has no link row.
 */
export function resolvePlanDiscount(
  promo: PromoDiscountInput,
  planId: string | number,
  basePrice: number,
  planDiscountMap: Map<string, PlanLinkPercentages>
): PerPlanDiscount {
  if (!(basePrice > 0))
    return { amount: 0, appliedPercentage: null, promoterPercentage: 0, source: "legacy" };

  const link = planDiscountMap.get(String(planId));
  if (link !== undefined && link.customerPercentage > 0) {
    const amount = Math.min(
      basePrice,
      Math.max(0, Math.round((basePrice * link.customerPercentage) / 100))
    );
    return {
      amount,
      appliedPercentage: link.customerPercentage,
      promoterPercentage: link.promoterPercentage,
      source: "per-plan",
    };
  }

  // Legacy fallback: top-level discountValue/discountType. Legacy codes have no
  // per-plan promoter split, so promoterPercentage is 0 here.
  const amount = computePromoDiscount(promo, basePrice);
  const appliedPercentage = promo.discountType === "percentage" ? Number(promo.discountValue ?? 0) : null;
  return { amount, appliedPercentage, promoterPercentage: 0, source: "legacy" };
}
