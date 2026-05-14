import { PromoCode, IPromoCode } from "../../models/course/PromoCode.model";

export interface LivePromoResult {
  promo: IPromoCode;
  discountType: "flat" | "percentage";
  discountValue: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
}

/**
 * Validate a promo code and apply its promo-level discount to a base amount.
 *
 * Live courses have no per-plan promotion table — `PromotedPackageCourseEbook`
 * targets `PackageCourseEbookPrice`, not `LiveCoursePlan` — so here we use the
 * discount carried directly on the PromoCode (`discountType` + `discountValue`).
 * Any active code within its validity window therefore acts as a global
 * discount on live course plans. (Referral codes are intentionally NOT handled
 * here; that's a separate promoter-attribution flow.)
 *
 * Returns `{ error }` on any validation failure so the caller can map it to a
 * 4xx — it never throws for the "code is bad" case.
 */
export async function resolveLivePromo(
  rawCode: string,
  baseAmount: number
): Promise<{ result?: LivePromoResult; error?: string }> {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!code) return { error: "Promo code is required." };
  if (!(baseAmount > 0)) return { error: "Promo codes don't apply to a zero-priced plan." };

  const now = new Date();
  const promo = await PromoCode.findOne({
    promocode: code,
    status: true,
    promo_start_at: { $lt: now },
    promo_expire_at: { $gt: now },
  });
  if (!promo) return { error: "Invalid or expired promo code." };

  const discountValue = Number(promo.discountValue ?? 0);
  if (!(discountValue > 0)) {
    return { error: "This promo code has no discount configured." };
  }

  let discountAmount =
    promo.discountType === "percentage"
      ? Math.round((baseAmount * discountValue) / 100)
      : Math.round(discountValue);

  // Never discount below zero or beyond the plan price.
  discountAmount = Math.min(baseAmount, Math.max(0, discountAmount));
  const finalAmount = baseAmount - discountAmount;

  return {
    result: {
      promo,
      discountType: promo.discountType,
      discountValue,
      originalAmount: baseAmount,
      discountAmount,
      finalAmount,
    },
  };
}
