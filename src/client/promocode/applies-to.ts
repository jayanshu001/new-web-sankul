import { Types } from "mongoose";
import { PromoAppliesToType } from "../../models/course/PromoCode.model";

// Shape we actually need — accepts both hydrated `IPromoCode` docs and `.lean()`
// results, so callers don't have to pick one path.
interface PromoCoversInput {
  appliesTo?: {
    type: PromoAppliesToType;
    ids: Array<string | Types.ObjectId>;
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
  context: { type: PromoAppliesToType; id: string | Types.ObjectId }
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
