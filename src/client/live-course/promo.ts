import { PromoCode, IPromoCode, PromoAppliesToType } from "../../models/course/PromoCode.model";
import { promoCovers, computePromoDiscount } from "../promocode/applies-to";

export interface LivePromoResult {
  promo: IPromoCode;
  discountType: "flat" | "percentage";
  discountValue: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
}

/**
 * Validate a promo code for a specific live course and apply its discount.
 *
 * Phase-2 model: the promocode must explicitly cover the live course via its
 * `appliesTo` set. Discount comes from the promocode's own `discountType` /
 * `discountValue`. Referral codes are intentionally NOT handled here.
 */
export async function resolveLivePromo(
  rawCode: string,
  baseAmount: number,
  entity: { type: PromoAppliesToType; id: string }
): Promise<{ result?: LivePromoResult; error?: string }> {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!code) return { error: "Promo code is required." };
  if (!(baseAmount > 0)) return { error: "Promo codes don't apply to a zero-priced plan." };
  if (!entity?.id) return { error: "Entity context is required." };

  const now = new Date();
  const promo = await PromoCode.findOne({
    promocode: code,
    status: true,
    promo_start_at: { $lt: now },
    promo_expire_at: { $gt: now },
  });
  if (!promo) return { error: "Invalid or expired promo code." };

  if (!promoCovers(promo, entity)) {
    return { error: "This promo code is not valid for this item." };
  }

  const discountValue = Number(promo.discountValue ?? 0);
  if (!(discountValue > 0)) {
    return { error: "This promo code has no discount configured." };
  }

  const discountAmount = computePromoDiscount(promo, baseAmount);
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
