/**
 * Commerce · Order (WRITE — Phase 3b, COURSE) service — dual-path (MySQL ↔ Mongo).
 *
 * Module key: `commerce-order`. Gates the course purchase flow across BOTH
 * create-order and verify. See commerce-order.types.ts for the full scope/drift
 * block and docs/migration/WRITE_PATH_SCOPE.md for the signed-off design.
 *
 * Exposes:
 *  - isCommerceOrderMysql() / parseCommerceOrderId()
 *  - createCourseOrderMysql()      — write the pending order row (create-order)
 *  - findCourseOrderForVerify()    — DUAL-READ owner lookup (the rollback net):
 *      checks MySQL when the flag is ON, falls back to Mongo-store miss handled
 *      by the caller. (verify-only, read-only.)
 *  - verifyCourseOrderMysql()      — transactional fulfillment (flip order →
 *      complete; create this order's entitlement + tracking); idempotent.
 *
 * Flag stays OFF until a separate go-live sign-off.
 */
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

export const COMMERCE_ORDER_MODULE = "commerce-order";
/** Package write-path flag — toggled independently from course (same module/tables). */
export const PACKAGE_ORDER_MODULE = "package-order";

/** Whether the course write-path is served from MySQL. */
export const isCommerceOrderMysql = (): boolean => true;

/** Whether the package write-path is served from MySQL. */
export const isPackageOrderMysql = (): boolean => true;

/** Parse a string id to a positive int, else null. */
export const parseCommerceOrderId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The legacy V1 `minimumAmount.course` floor, restored 2026-08-20. A material plan's
 * digital portion may never be booked at ₹0 — accounting needs a non-zero course
 * line even when a heavy promo pushes the paid amount below the material price.
 */
const MIN_COURSE_AMOUNT = 100;

/**
 * Split the paid amount into the digital course portion and the physical material
 * portion (PC_MATERIAL_SUBSCRIPTION_FLOW). Mirrors the legacy V1 logic, which —
 * across all three discount branches — reduces to the same shape once the order
 * already carries the post-discount paid amount:
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

/**
 * Read an active COURSE plan for create-order: returns {courseId, duration,
 * price} or null if the plan doesn't exist / isn't a course plan / is free /
 * is deactivated (`status=false`). Guarding on status here stops a disabled
 * price row from being purchased at create-order time.
 */
export const findCoursePlanForOrder = async (
  planId: number
): Promise<{ courseId: number; price: number; duration: number } | null> => {
  const plan = await repo.findPlan(planId);
  if (!plan?.courseId || plan.status === false || !plan.price || plan.price <= 0) return null;
  return { courseId: plan.courseId, price: plan.price, duration: plan.duration ?? 0 };
};

// ── create-order (write the pending order row) ──────────────────────────────

/**
 * Write a pending course order to MySQL and return its id. The Razorpay order is
 * created by the controller (external call); we persist its id here so verify can
 * find it. customerId is the int migrated id; the repo casts to the VARCHAR
 * order column.
 */
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
  // Receipt id (unique_id) + full Razorpay order payload (razorpay_order) so the
  // order row is fully populated, matching the ebook/book order create paths.
  uniqueId?: string | null;
  razorpayOrderPayload?: string | null;
  // Delivery address for "With Materials" plans; persisted on the order row so
  // verify can stamp it onto the fulfilled subscription. Null for digital-only.
  customerShippingId?: number | null;
  // Referrer to credit at verify when a referral code was applied (else null).
  referrerId?: number | null;
  // Wallet coins redeemed; debited at verify (stored in ws_coin). 0/null = none.
  coin?: number | null;
}): Promise<CreatedCourseOrder> => {
  const order = await repo.createPendingOrder({ ...input, shippingId: input.customerShippingId ?? null });
  return { orderId: order.id };
};

// ── verify: dual-read owner lookup ──────────────────────────────────────────

/**
 * Owner lookup for verify. Returns the course order row (minimal) iff a MySQL
 * order owns this Razorpay id for this customer AND its plan is a course plan.
 * Returns null on miss — the caller then falls back to the Mongo lookup (the
 * dual-read fallback that makes a flag flip between create-order and verify
 * non-orphaning). Read-only; safe to call regardless of flag state.
 */
export const findCourseOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
): Promise<CourseOrderRow | null> => {
  const order = await repo.findOrderByRazorpay(razorpayOrderId, String(customerId));
  if (!order) return null;
  // Confirm it's a COURSE order (plan has a course_id). Ebook orders share the
  // table; only course orders are in this module's scope.
  if (order.planId == null) return null;
  const plan = await repo.findPlan(order.planId);
  if (!plan?.courseId) return null;
  return toCourseOrderRow(order);
};

// ── verify: transactional fulfillment ───────────────────────────────────────

/**
 * Fulfill a verified course payment. Idempotent: if the order is already
 * complete, returns the existing entitlement without re-running side effects.
 * Otherwise, in ONE transaction: flips the order → complete and creates THIS
 * order's subscription + tracking row. A renewal gets its own row continuing from
 * the current entitlement's endAt — it never folds onto the existing row.
 *
 * `duration` is DAYS (RESUME_HERE §6) — endAt via planDuration `asDays:true`.
 */
export const verifyCourseOrderMysql = async (
  order: CourseOrderRow,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<VerifiedCourseSubscriptionDto> => {
  // Idempotency: already verified → return the existing merged doc.
  if (order.paymentStatus !== "pending") {
    const existing = await repo.findSubByOrder(order.id);
    const orderRow = await repo.findOrderByRazorpay(
      order.razorpayOrderId ?? "",
      order.customerIdStr ?? ""
    );
    if (existing && orderRow) {
      return toVerifiedCourseSubscriptionDto(orderRow, existing);
    }
    // Defensive: complete order but no subscription found — fall through to
    // re-create rather than silently return a partial. (Should not happen.)
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

  // Physical-material split + kit resolution (PC_MATERIAL_SUBSCRIPTION_FLOW).
  // Resolved for every purchase, renewals included: each row now carries its own
  // split and its own kit. pcMaterialId is copied from the COURSE.
  const split = computeMaterialSplit(amount, plan);
  const pcMaterialId = split.withMaterial
    ? await repo.findCoursePcMaterialId(courseId)
    : null;
  const material: MaterialFulfillment = { ...split, pcMaterialId };

  // ONE ORDER = ONE SUBSCRIPTION ROW — a renewal never folds onto the customer's
  // existing row. We only READ the current entitlement to find where the new window
  // should start: still active → the new row picks up at its endAt (no overlap, no
  // gap); lapsed, lifetime or absent → it starts now. The prior row is left exactly
  // as it was, so its price, plan and dispatch record stay intact and its `order_id`
  // keeps pointing at the order that actually paid for it.
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
    // This purchase's own amount — NOT summed onto the previous row's. Each row is
    // now its own purchase record, so the money belongs to the row that earned it.
    amount,
    now,
    material,
    startAt,
    endAt,
    extended: !!existingActive,
  });
  // Reward the referrer (if this order used a referral code). Idempotent +
  // non-throwing — a credit failure never blocks the customer's fulfillment.
  await creditReferrer({ referrerId: order.referrerId, buyerId: customerId, orderId: order.id, paidAmount: amount, source: "course" });
  await debitWallet({ customerId, orderId: order.id, coin: order.walletCoin, source: "course" });
  return toVerifiedCourseSubscriptionDto(result.order, result.subscription);
};

// ── PACKAGE write-path (same tables/module; toggled by `package-order` flag) ──
// Twin of the course path: the only differences are the plan must be a PACKAGE
// plan (plan.packageId set, no courseId) and the fulfilled sub sets package_id
// (course_id null). DAYS duration, idempotent, dual-read fallback — all identical.

/** Read an active PACKAGE plan for create-order. Null if missing/not-a-package/free/deactivated. */
export const findPackagePlanForOrder = async (
  planId: number
): Promise<{ packageId: number; price: number; duration: number } | null> => {
  const plan = await repo.findPlan(planId);
  if (!plan?.packageId || plan.courseId || plan.status === false || !plan.price || plan.price <= 0) return null;
  return { packageId: plan.packageId, price: plan.price, duration: plan.duration ?? 0 };
};

/** Write a pending PACKAGE order (same order table/shape as course). */
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
  // Receipt id (unique_id) + full Razorpay order payload (razorpay_order).
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

/**
 * Owner lookup for verify — returns the order row iff it's a PACKAGE order (plan
 * has packageId, no courseId). Null on miss → caller falls back to Mongo.
 */
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

/** Fulfill a verified PACKAGE payment (always a new sub row, idempotent). DAYS duration. */
export const verifyPackageOrderMysql = async (
  order: CourseOrderRow,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<VerifiedCourseSubscriptionDto> => {
  if (order.paymentStatus !== "pending") {
    const existing = await repo.findSubByOrder(order.id);
    const orderRow = await repo.findOrderByRazorpay(order.razorpayOrderId ?? "", order.customerIdStr ?? "");
    if (existing && orderRow) return toVerifiedCourseSubscriptionDto(orderRow, existing);
  }
  if (order.planId == null) throw new Error("package-order: order has no plan id");
  const plan = await repo.findPlan(order.planId);
  const packageId = plan?.packageId ?? null;
  if (packageId == null) throw new Error("package-order: plan is not a package plan");
  const durationDays = plan?.duration ?? 0;
  const customerId = Number(order.customerIdStr);
  const amount = order.amount ?? 0;

  // Physical-material split + kit resolution (PC_MATERIAL_SUBSCRIPTION_FLOW).
  // pcMaterialId is copied from the PACKAGE. See verifyCourseOrderMysql for notes.
  const split = computeMaterialSplit(amount, plan);
  const pcMaterialId = split.withMaterial
    ? await repo.findPackagePcMaterialId(packageId)
    : null;
  const material: MaterialFulfillment = { ...split, pcMaterialId };

  // ONE ORDER = ONE SUBSCRIPTION ROW (see verifyCourseOrderMysql). The existing sub
  // is read only to place the new window; it is never modified.
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
  await creditReferrer({ referrerId: order.referrerId, buyerId: customerId, orderId: order.id, paidAmount: amount, source: "package" });
  await debitWallet({ customerId, orderId: order.id, coin: order.walletCoin, source: "package" });
  return toVerifiedCourseSubscriptionDto(result.order, result.subscription);
};
