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
 *      complete; extend-or-create the entitlement + tracking); idempotent.
 *
 * Flag stays OFF until a separate go-live sign-off.
 */
import { isMysqlModule } from "../../config/migration";
import { computeEndAt, extendEndAt } from "../../utils/planDuration";
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
export const isCommerceOrderMysql = (): boolean =>
  isMysqlModule(COMMERCE_ORDER_MODULE);

/** Whether the package write-path is served from MySQL. */
export const isPackageOrderMysql = (): boolean =>
  isMysqlModule(PACKAGE_ORDER_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseCommerceOrderId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Split the paid amount into the digital course portion and the physical material
 * portion (PC_MATERIAL_SUBSCRIPTION_FLOW). Mirrors the legacy V1 logic, which —
 * across all three discount branches — reduces to the same shape once the order
 * already carries the post-discount paid amount:
 *
 *   courseAmount   = max(paidAmount − materialPrice, 0)   // digital portion
 *   materialAmount = paidAmount − courseAmount            // residual (physical)
 *
 * Keeping materialAmount as the residual guarantees courseAmount + materialAmount
 * stays exactly equal to what the customer paid. With no material, courseAmount is
 * the full amount and materialAmount is null. The clamp at 0 (rather than the
 * legacy `minimumAmount.course` floor, which has no constant in this codebase)
 * just prevents a negative digital portion when a heavy promo drops the paid
 * amount below the plan's materialPrice. `pcMaterialId` is filled in by the caller.
 */
const computeMaterialSplit = (
  paidAmount: number,
  plan: { withMaterial?: boolean | null; materialPrice?: number | null } | null
): Omit<MaterialFulfillment, "pcMaterialId"> => {
  if (!plan?.withMaterial) {
    return { courseAmount: paidAmount, materialAmount: null, withMaterial: false };
  }
  const materialPrice = plan.materialPrice ?? 0;
  const courseAmount = Math.max(paidAmount - materialPrice, 0);
  const materialAmount = paidAmount - courseAmount;
  return { courseAmount, materialAmount, withMaterial: true };
};

/**
 * Read an active COURSE plan for create-order: returns {courseId, duration,
 * price} or null if the plan doesn't exist / isn't a course plan / is free.
 * (The plan's status isn't on this select; commerce-price owns active-status
 * reads — create-order only needs the course/price facts.)
 */
export const findCoursePlanForOrder = async (
  planId: number
): Promise<{ courseId: number; price: number; duration: number } | null> => {
  const plan = await repo.findPlan(planId);
  if (!plan?.courseId || !plan.price || plan.price <= 0) return null;
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
  price: number;
  razorpayOrderId: string;
  // Delivery address for "With Materials" plans; persisted on the order row so
  // verify can stamp it onto the fulfilled subscription. Null for digital-only.
  customerShippingId?: number | null;
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
 * Otherwise, in ONE transaction: flips the order → complete and either extends
 * the customer's existing active course subscription (folding window + amount) or
 * creates a fresh subscription + tracking row.
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

  // Physical-material split + kit resolution (PC_MATERIAL_SUBSCRIPTION_FLOW). The
  // material portion/kit are only meaningful on a fresh grant — the extend path
  // just folds window + amount onto an existing row — but we resolve once and pass
  // through so the tx input is uniform. pcMaterialId is copied from the COURSE.
  const split = computeMaterialSplit(amount, plan);
  const pcMaterialId = split.withMaterial
    ? await repo.findCoursePcMaterialId(courseId)
    : null;
  const material: MaterialFulfillment = { ...split, pcMaterialId };

  // Upsert-extend: fold onto an existing active verified course subscription.
  const existingActive = await repo.findActiveCourseSub(
    customerId,
    courseId,
    null,
    now
  );

  if (existingActive) {
    const newEndAt = extendEndAt({
      currentEndAt: existingActive.endAt,
      durationMonths: durationDays,
      asDays: true,
      now,
    });
    const prevAmount = existingActive.amount ? Number(existingActive.amount.toString()) : 0;
    const result = await repo.verifyCourseTx({
      orderId: order.id,
      razorpayPaymentId,
      customerId,
      courseId,
      planId: order.planId,
      amount,
      now,
      material,
      extend: {
        existingSubId: existingActive.id,
        newEndAt,
        newAmount: prevAmount + amount,
      },
    });
    return toVerifiedCourseSubscriptionDto(result.order, result.subscription);
  }

  // Fresh grant.
  const startAt = now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });
  const result = await repo.verifyCourseTx({
    orderId: order.id,
    razorpayPaymentId,
    customerId,
    courseId,
    planId: order.planId,
    amount,
    now,
    material,
    fresh: { startAt, endAt },
  });
  return toVerifiedCourseSubscriptionDto(result.order, result.subscription);
};

// ── PACKAGE write-path (same tables/module; toggled by `package-order` flag) ──
// Twin of the course path: the only differences are the plan must be a PACKAGE
// plan (plan.packageId set, no courseId) and the fulfilled sub sets package_id
// (course_id null). DAYS duration, idempotent, dual-read fallback — all identical.

/** Read an active PACKAGE plan for create-order. Null if missing/not-a-package/free. */
export const findPackagePlanForOrder = async (
  planId: number
): Promise<{ packageId: number; price: number; duration: number } | null> => {
  const plan = await repo.findPlan(planId);
  if (!plan?.packageId || plan.courseId || !plan.price || plan.price <= 0) return null;
  return { packageId: plan.packageId, price: plan.price, duration: plan.duration ?? 0 };
};

/** Write a pending PACKAGE order (same order table/shape as course). */
export const createPackageOrderMysql = async (input: {
  customerId: number;
  planId: number;
  price: number;
  razorpayOrderId: string;
  customerShippingId?: number | null;
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

/** Fulfill a verified PACKAGE payment (fold-or-fresh, idempotent). DAYS duration. */
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

  const existingActive = await repo.findActivePackageSub(customerId, packageId, null, now);
  if (existingActive) {
    const newEndAt = extendEndAt({ currentEndAt: existingActive.endAt, durationMonths: durationDays, asDays: true, now });
    const prevAmount = existingActive.amount ? Number(existingActive.amount.toString()) : 0;
    const result = await repo.verifyPackageTx({
      orderId: order.id, razorpayPaymentId, customerId, packageId, planId: order.planId, amount, now, material,
      extend: { existingSubId: existingActive.id, newEndAt, newAmount: prevAmount + amount },
    });
    return toVerifiedCourseSubscriptionDto(result.order, result.subscription);
  }

  const startAt = now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });
  const result = await repo.verifyPackageTx({
    orderId: order.id, razorpayPaymentId, customerId, packageId, planId: order.planId, amount, now, material,
    fresh: { startAt, endAt },
  });
  return toVerifiedCourseSubscriptionDto(result.order, result.subscription);
};
