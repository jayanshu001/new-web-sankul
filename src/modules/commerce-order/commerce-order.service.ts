// Course/package orders: create-order + verify purchase flow (table split in types.ts).
import { computeEndAt } from "../../utils/planDuration";
import type {
  PromocodeSnapshot,
  ReferralSnapshot,
} from "../order-code-snapshot/order-code-snapshot.types";
import { creditReferrer } from "../../client/referral/credit-referrer";
import { debitWallet } from "../../client/referral/debit-wallet";
import { commerceOrderRepository as repo } from "./commerce-order.repository";
import type { MaterialFulfillment } from "./commerce-order.repository";
import {
  toCourseOrderRow,
  toVerifiedCourseSubscriptionDto,
} from "./commerce-order.transformer";
import type {
  CourseOrderRow,
  CreatedCourseOrder,
  VerifiedCourseSubscriptionDto,
} from "./commerce-order.types";

export const parseCommerceOrderId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * A material plan's digital portion may never be booked at ₹0: accounting needs a non-zero
 * course line even when a heavy promo pushes the paid amount below the material price.
 */
const MIN_COURSE_AMOUNT = 100;

/**
 * Splits the paid amount into the digital course portion and the physical material portion
 * (PC_MATERIAL_SUBSCRIPTION_FLOW):
 *
 *   courseAmount   = clamp(paidAmount − materialPrice, MIN_COURSE_AMOUNT, paidAmount)
 *   materialAmount = paidAmount − courseAmount                     // residual (physical)
 *
 * Keeping materialAmount as the residual guarantees courseAmount + materialAmount
 * stays exactly equal to what the customer paid. With no material, courseAmount is
 * the full amount and materialAmount is null.
 *
 * Worked example (6-month plan, materialPrice 8000):
 *
 *   paid 13000 → 13000 − 8000 =  5000  → course  5000, material 8000
 *   paid  6500 →  6500 − 8000 = −1500  → course   100, material 6400   ← the floor
 *
 * The floor is what stops a promo that drops the paid amount to or below the material
 * price from booking the whole sale as material and ₹0 of course.
 *
 * ⚠ The floor CANNOT be honoured when paidAmount is itself ≤ ₹100 (reachable — the
 * minimum payable is ₹1). Applying it blindly there drives materialAmount NEGATIVE,
 * and capping course at paidAmount instead stores materialAmount = 0 — which the
 * Subscription Material Report reads as "Without Material" (admin-subscription
 * `rowHasMaterial` = pcMaterialId > 0 || materialAmount > 0), so a real material order
 * would silently drop out of the dispatch report and never ship. In that corner
 * material keeps ₹1 and course takes the remainder: the money still sums to what was
 * paid AND the row stays visibly a material order. Fulfilment beats the accounting
 * floor when the two cannot both hold.
 *
 * `pcMaterialId` is filled in by the caller.
 */
export const computeMaterialSplit = (
  paidAmount: number,
  plan: { withMaterial?: boolean | null; materialPrice?: number | null } | null
): Omit<MaterialFulfillment, "pcMaterialId"> => {
  if (!plan?.withMaterial) {
    return { courseAmount: paidAmount, materialAmount: null, withMaterial: false };
  }
  const materialPrice = plan.materialPrice ?? 0;
  const raw = paidAmount - materialPrice;
  const courseAmount =
    raw >= MIN_COURSE_AMOUNT
      ? raw
      // Floor applies — but never at the cost of leaving material at 0 (see above).
      : Math.min(MIN_COURSE_AMOUNT, Math.max(paidAmount - 1, 0));
  const materialAmount = paidAmount - courseAmount;
  return { courseAmount, materialAmount, withMaterial: true };
};

/** Null if the plan is missing, not a course plan, free, or deactivated (a disabled price row must not be purchasable). */
export const findCoursePlanForOrder = async (
  planId: number
): Promise<{ courseId: number; price: number; duration: number } | null> => {
  const plan = await repo.findPlan(planId);
  if (!plan?.courseId || plan.status === false || !plan.price || plan.price <= 0) return null;
  return { courseId: plan.courseId, price: plan.price, duration: plan.duration ?? 0 };
};

/** The controller creates the Razorpay order; its id is persisted here so verify can find it. */
export const createCourseOrderMysql = async (input: {
  customerId: number;
  planId: number;
  /** Charged amount (post-promo, post-coin) → `discount_price`. */
  price: number;
  /** Plan list price → `price`. Omit only when there is no discount at all. */
  originalPrice?: number | null;
  /** Promo/referral discount in rupees → `code_discount` (wallet coins excluded). */
  codeDiscount?: number | null;
  /** Purchase-time promocode snapshot object → `promocode` json column. */
  promoCode?: PromocodeSnapshot | null;
  /** Purchase-time referral snapshot object → `refferalcode` json column. */
  referralCode?: ReferralSnapshot | null;
  razorpayOrderId: string;
  uniqueId?: string | null;
  razorpayOrderPayload?: string | null;
  // Delivery address for "With Materials" plans; verify stamps it onto the subscription.
  customerShippingId?: number | null;
  // Referrer to credit at verify when a referral code was applied (else null).
  referrerId?: number | null;
  // Wallet coins redeemed; debited at verify (stored in ws_coin). 0/null = none.
  coin?: number | null;
}): Promise<CreatedCourseOrder> => {
  const order = await repo.createPendingOrder({ ...input, shippingId: input.customerShippingId ?? null });
  return { orderId: order.id };
};

/** The order iff it owns this Razorpay id for this customer AND its plan is a course plan. */
export const findCourseOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
): Promise<CourseOrderRow | null> => {
  const order = await repo.findOrderByRazorpay(razorpayOrderId, String(customerId));
  if (!order) return null;
  // Other order kinds share the table; only course plans qualify here.
  if (order.planId == null) return null;
  const plan = await repo.findPlan(order.planId);
  if (!plan?.courseId) return null;
  return toCourseOrderRow(order);
};

/** The entitlement an order already produced, or null if it produced none. */
const findFulfilled = async (
  order: CourseOrderRow
): Promise<VerifiedCourseSubscriptionDto | null> => {
  const existing = await repo.findSubByOrder(order.id);
  const orderRow = await repo.findOrderByRazorpay(
    order.razorpayOrderId ?? "",
    order.customerIdStr ?? ""
  );
  return existing && orderRow ? toVerifiedCourseSubscriptionDto(orderRow, existing) : null;
};

/**
 * The claim matched 0 rows: a concurrent /verify or webhook fulfilled this order
 * first (its transaction has committed — our UPDATE waited on its row lock).
 * Return what it produced; never fulfil a second time.
 */
const alreadyFulfilled = async (
  order: CourseOrderRow
): Promise<VerifiedCourseSubscriptionDto> => {
  const done = await findFulfilled(order);
  if (!done) throw new Error("commerce-order: order is not pending and has no subscription");
  return done;
};

/**
 * Idempotent: an already-complete order returns its existing entitlement without re-running
 * side effects. Otherwise one transaction flips the order to complete and creates THIS order's
 * subscription + tracking row. A renewal gets its own row continuing from the current endAt.
 * `duration` is DAYS.
 */
export const verifyCourseOrderMysql = async (
  order: CourseOrderRow,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<VerifiedCourseSubscriptionDto> => {
  if (order.paymentStatus !== "pending") {
    const done = await findFulfilled(order);
    if (done) return done;
    // No subscription for a non-pending order: falls through, the claim in
    // verifyCourseTx matches 0 rows, and alreadyFulfilled() throws.
  }

  if (order.planId == null) {
    throw new Error("commerce-order: course order has no plan id");
  }
  const plan = await repo.findPlan(order.planId);
  const courseId = plan?.courseId ?? null;
  if (courseId == null) {
    throw new Error("commerce-order: plan is not a course plan");
  }
  const durationDays = plan?.duration ?? 0;
  const customerId = Number(order.customerIdStr);
  const amount = order.amount ?? 0;

  // Resolved for every purchase, renewals included: each row carries its own split and kit.
  // pcMaterialId is copied from the COURSE.
  const split = computeMaterialSplit(amount, plan);
  const pcMaterialId = split.withMaterial
    ? await repo.findCoursePcMaterialId(courseId)
    : null;
  const material: MaterialFulfillment = { ...split, pcMaterialId };

  // ONE ORDER = ONE SUBSCRIPTION ROW. The current entitlement is only read to place the new
  // window: still active → start at its endAt (no overlap, no gap); lapsed, lifetime or absent
  // → start now. The prior row is never modified, so its `order_id` stays the order that paid.
  const existingActive = await repo.findActiveCourseSub(
    customerId,
    courseId,
    null,
    now
  );
  const startAt =
    existingActive?.endAt && existingActive.endAt.getTime() > now.getTime()
      ? existingActive.endAt
      : now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });

  const result = await repo.verifyCourseTx({
    orderId: order.id,
    razorpayPaymentId,
    customerId,
    courseId,
    planId: order.planId,
    // This purchase's own amount, never summed onto the previous row's.
    amount,
    now,
    material,
    startAt,
    endAt,
    extended: !!existingActive,
  });
  if (!result) return alreadyFulfilled(order);
  // Idempotent + non-throwing: a credit failure never blocks fulfillment.
  await creditReferrer({ referrerId: order.referrerId, buyerId: customerId, orderId: order.id, paidAmount: amount, source: "course" });
  await debitWallet({ customerId, orderId: order.id, coin: order.walletCoin, source: "course" });
  return toVerifiedCourseSubscriptionDto(result.order, result.subscription);
};

// Package twin of the course path: the plan must be a PACKAGE plan (packageId set, no
// courseId) and the fulfilled sub sets package_id (course_id null). Otherwise identical.

/** Null if missing, not a package plan, free, or deactivated. */
export const findPackagePlanForOrder = async (
  planId: number
): Promise<{ packageId: number; price: number; duration: number } | null> => {
  const plan = await repo.findPlan(planId);
  if (!plan?.packageId || plan.courseId || plan.status === false || !plan.price || plan.price <= 0) return null;
  return { packageId: plan.packageId, price: plan.price, duration: plan.duration ?? 0 };
};

export const createPackageOrderMysql = async (input: {
  customerId: number;
  planId: number;
  /** Charged amount (post-promo, post-coin) → `discount_price`. */
  price: number;
  /** Plan list price → `price`. Omit only when there is no discount at all. */
  originalPrice?: number | null;
  /** Promo/referral discount in rupees → `code_discount` (wallet coins excluded). */
  codeDiscount?: number | null;
  /** Purchase-time promocode snapshot object → `promocode` json column. */
  promoCode?: PromocodeSnapshot | null;
  /** Purchase-time referral snapshot object → `refferalcode` json column. */
  referralCode?: ReferralSnapshot | null;
  razorpayOrderId: string;
  uniqueId?: string | null;
  razorpayOrderPayload?: string | null;
  customerShippingId?: number | null;
  // Referrer to credit at verify when a referral code was applied (else null).
  referrerId?: number | null;
  // Wallet coins redeemed; debited at verify (stored in ws_coin). 0/null = none.
  coin?: number | null;
}): Promise<CreatedCourseOrder> => {
  const order = await repo.createPendingOrder({ ...input, shippingId: input.customerShippingId ?? null });
  return { orderId: order.id };
};

/** The order iff it's a PACKAGE order (plan has packageId, no courseId). */
export const findPackageOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
): Promise<CourseOrderRow | null> => {
  const order = await repo.findOrderByRazorpay(razorpayOrderId, String(customerId));
  if (!order || order.planId == null) return null;
  const plan = await repo.findPlan(order.planId);
  if (!plan?.packageId || plan.courseId) return null;
  return toCourseOrderRow(order);
};

/** See verifyCourseOrderMysql: idempotent, always a new sub row, DAYS duration. */
export const verifyPackageOrderMysql = async (
  order: CourseOrderRow,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<VerifiedCourseSubscriptionDto> => {
  if (order.paymentStatus !== "pending") {
    const done = await findFulfilled(order);
    if (done) return done;
  }
  if (order.planId == null) throw new Error("package-order: order has no plan id");
  const plan = await repo.findPlan(order.planId);
  const packageId = plan?.packageId ?? null;
  if (packageId == null) throw new Error("package-order: plan is not a package plan");
  const durationDays = plan?.duration ?? 0;
  const customerId = Number(order.customerIdStr);
  const amount = order.amount ?? 0;

  // pcMaterialId is copied from the PACKAGE.
  const split = computeMaterialSplit(amount, plan);
  const pcMaterialId = split.withMaterial
    ? await repo.findPackagePcMaterialId(packageId)
    : null;
  const material: MaterialFulfillment = { ...split, pcMaterialId };

  // ONE ORDER = ONE SUBSCRIPTION ROW (see verifyCourseOrderMysql).
  const existingActive = await repo.findActivePackageSub(customerId, packageId, null, now);
  const startAt =
    existingActive?.endAt && existingActive.endAt.getTime() > now.getTime()
      ? existingActive.endAt
      : now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });
  const result = await repo.verifyPackageTx({
    orderId: order.id, razorpayPaymentId, customerId, packageId, planId: order.planId, amount, now, material,
    startAt, endAt, extended: !!existingActive,
  });
  if (!result) return alreadyFulfilled(order);
  await creditReferrer({ referrerId: order.referrerId, buyerId: customerId, orderId: order.id, paidAmount: amount, source: "package" });
  await debitWallet({ customerId, orderId: order.id, coin: order.walletCoin, source: "package" });
  return toVerifiedCourseSubscriptionDto(result.order, result.subscription);
};
