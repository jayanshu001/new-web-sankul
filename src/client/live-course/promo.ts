import mongoose from "mongoose";
import { PromoCode, IPromoCode, PromoAppliesToType } from "../../models/course/PromoCode.model";
import { Customer } from "../../models/customer/Customer.model";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import { promoCovers, loadPlanDiscountMap, resolvePlanDiscount, countPlanLinks, PlanLinkPercentages } from "../promocode/applies-to";

export interface LivePromoResult {
  // null when the applied code is a referral code rather than a marketing
  // promocode. Callers must guard `promo` access on `referrerId == null`.
  promo: IPromoCode | null;
  discountType: "flat" | "percentage";
  discountValue: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  // Promoter's commission cut for this plan (per-plan link %, or 0 for legacy).
  promoterPercentage: number;
  // promoterPercentage applied to the amount actually charged (finalAmount).
  promoterCommission: number;
  // ── Referral path ──────────────────────────────────────────────────────────
  // Set ONLY when the code matched a customer's referralCode (not a promocode).
  // referrerId is the customer to credit on a successful purchase; the buyer's
  // discount comes from the referral program's `referralDiscount`.
  referrerId: mongoose.Types.ObjectId | null;
  // The referral program's customer-side discount % (for surfacing in previews).
  customerPercentage: number | null;
}

/**
 * Validate a promo code for a specific live course and apply its discount.
 *
 * Phase-2 model: the promocode must explicitly cover the entity via its
 * `appliesTo` set. The discount for `planId` comes from that plan's per-plan
 * `customerPercentage` (link table), falling back to the promocode's top-level
 * `discountType`/`discountValue` when the plan has no link row. Referral codes
 * are intentionally NOT handled here.
 */
export async function resolveLivePromo(
  rawCode: string,
  baseAmount: number,
  entity: { type: PromoAppliesToType; id: string },
  planId?: string,
  // The buyer — needed to reject self-referral on the referral-code branch.
  userId?: string
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
  if (!promo) {
    // Not a marketing promocode — try the referral-code path before failing.
    // A customer's `referralCode` gives the BUYER the program's referralDiscount
    // and, on a successful purchase, credits the REFERRER (handled at verify/
    // webhook time via creditReferrer). Applies to every plan-based entity
    // (live-course, test-series, course, package, ebook) uniformly.
    const referral = await resolveReferral(code, baseAmount, userId);
    if (referral) return referral;     // matched + valid → referral result, OR self-referral error
    return { error: "Invalid or expired promo code." };
  }

  if (!promoCovers(promo, entity)) {
    return { error: "This promo code is not valid for this item." };
  }

  // Per-plan SCOPE enforcement: if a code has ANY per-plan link rows, it is
  // "per-plan scoped" — valid ONLY for plans that have a (promocodeId, planId)
  // row, even when the parent entity is in appliesTo.ids. A plan with no row is
  // out of scope and rejected. Codes with ZERO link rows are legacy: entity-level
  // scope only, discount via the top-level fallback (old behaviour preserved).
  const totalLinks = await countPlanLinks(String(promo._id));
  const planDiscountMap = planId
    ? await loadPlanDiscountMap(String(promo._id), [planId])
    : new Map<string, PlanLinkPercentages>();

  if (totalLinks > 0 && (!planId || !planDiscountMap.has(String(planId)))) {
    return { error: "This promo code is not valid for this plan." };
  }

  const resolved = resolvePlanDiscount(promo, String(planId ?? ""), baseAmount, planDiscountMap);

  if (!(resolved.amount > 0)) {
    return { error: "This promo code has no discount configured." };
  }

  const finalAmount = baseAmount - resolved.amount;
  // Commission is computed off the amount actually charged (finalAmount).
  const promoterCommission = Math.max(
    0,
    Math.round((finalAmount * resolved.promoterPercentage) / 100)
  );

  return {
    result: {
      promo,
      discountType: resolved.appliedPercentage !== null ? "percentage" : promo.discountType,
      discountValue: resolved.appliedPercentage !== null ? resolved.appliedPercentage : Number(promo.discountValue ?? 0),
      originalAmount: baseAmount,
      discountAmount: resolved.amount,
      finalAmount,
      promoterPercentage: resolved.promoterPercentage,
      promoterCommission,
      referrerId: null,
      customerPercentage: null,
    },
  };
}

// Resolve a code as a customer referral code. Returns a LivePromoResult shaped
// like the promocode path (so callers compute charge/discount identically) but
// with `promo: null`, `referrerId` set, and no promoter commission. Returns null
// when the code isn't a valid, active referral code so the caller can fall
// through to its "invalid code" error.
async function resolveReferral(
  code: string,
  baseAmount: number,
  userId?: string
): Promise<{ result?: LivePromoResult; error?: string } | null> {
  const [referralCustomer, program] = await Promise.all([
    Customer.findOne({ referralCode: code, isAccountDeleted: false, status: true })
      .select("_id")
      .lean(),
    ReferralProgram.findOne({ name: "student", status: true })
      .select("referralDiscount minimumPrice")
      .lean(),
  ]);
  // Not a referral code (or the program is off) → let the caller emit its
  // generic "invalid code" error.
  if (!referralCustomer || !program) return null;

  // It IS a real referral code, but the buyer is trying to use their own — give
  // an explicit, actionable message instead of a generic "invalid code".
  if (userId && String(userId) === String(referralCustomer._id)) {
    return {
      error:
        "Oops! It looks like you're trying to use your own referral code. Please refer a friend or family member instead.",
    };
  }

  // Discount only applies above the program's minimum price; below it the buyer
  // pays full price but the referrer is still credited on purchase.
  const pct = baseAmount > program.minimumPrice ? program.referralDiscount : 0;
  const discountAmount = Math.round((baseAmount * pct) / 100);
  const finalAmount = Math.max(0, baseAmount - discountAmount);

  return {
    result: {
      promo: null,
      discountType: "percentage",
      discountValue: pct,
      originalAmount: baseAmount,
      discountAmount,
      finalAmount,
      promoterPercentage: 0,
      promoterCommission: 0,
      referrerId: referralCustomer._id as mongoose.Types.ObjectId,
      customerPercentage: pct,
    },
  };
}
