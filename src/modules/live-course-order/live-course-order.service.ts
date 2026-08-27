import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { computeEndAt } from "../../utils/planDuration";
import { creditReferrer } from "../../client/referral/credit-referrer";
import { debitWallet } from "../../client/referral/debit-wallet";
// The course/material money split is NOT re-derived here — it is the shared helper
// ws_package_course_subscription has always used, so both products book the split
// identically (floor at MIN_COURSE_AMOUNT, material as the residual).
import { computeMaterialSplit } from "../commerce-order/commerce-order.service";

/**
 * Live-course payment write path on SQL.
 *
 * Since 2026-08-25 live course has a real order table and follows the same rule as
 * every other product: THE ORDER OWNS PAYMENT, THE SUBSCRIPTION OWNS ENTITLEMENT,
 * and ONE ORDER = ONE SUBSCRIPTION ROW. Checkout writes a pending
 * `ws_live_course_order`; verify flips it to complete and CREATES a subscription row
 * for it. A renewal gets its own order and its own subscription row starting where
 * the current entitlement ends — it never folds onto the existing row.
 *
 * Before that, the design was SINGLE-TABLE: `ws_live_course_subscription` carried
 * the payment fields too, checkout wrote a `payment_status='pending'` subscription
 * row, and a renewal had to fold (bump end_at, retire the pending row) because there
 * was no second table to record the second payment. Those payment columns still
 * exist on the subscription for pre-migration rows — new writes do not touch them.
 *
 * ⚠ plan.duration is DAYS (per the live-course controllers + admin-live-course
 * grant — computeEndAt asDays:true). The schema comment saying MONTHS is stale;
 * DAYS is the shipped precedent. See [[project_plan_duration_unit]].
 * withMaterial / customerShippingId are persisted on the SQL SUBSCRIPTION
 * (ws_live_course_subscription.with_material / customer_shipping_id). withMaterial
 * is derived from the selected plan's flag; customerShippingId is the delivery
 * address chosen at checkout (validated for ownership in the controller).
 *
 * ⚠ 2026-08-27: the order table adopted the ws_package_course_order shape column for
 * column. `with_material` left the ORDER (package does not have it — it is a property
 * of the plan, ws_live_course_plan.with_material), `customer_shipping_id` became
 * `shipping`, `paid_amount` became `discount_price` (Prisma `amount`),
 * `original_amount` became `price` (Prisma `originalPrice`, now ALWAYS written),
 * `wallet_coin` became `ws_coin`, and `paid_at` is gone — `updated_at` is the paid-at
 * on every order table, which is where the package receipt has always read it.
 */
export const LIVE_COURSE_ORDER_MODULE = "live-course-order";
export const isLiveCourseOrderMysql = (): boolean => true;

export type LiveCourseVerifyDto = {
  _id: string;
  customerId: number;
  liveCourseId: number;
  planId: number | null;
  startAt: Date | null;
  endAt: Date | null;
  status: boolean;
  paidAmount: number | null;
  paymentStatus: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/**
 * The verify DTO is unchanged on the wire: entitlement fields come from the
 * subscription, payment fields from the order. `paymentStatus` still reports the
 * subscription vocabulary ("verified"), NOT the order's "complete" — the field is
 * part of a shipped response shape and is mapped, not renamed.
 *
 * `sub` is null only on the defensive path where an order is complete but its
 * subscription is missing; the DTO then carries the order's own identity so the
 * caller still gets a well-formed response.
 */
const ORDER_STATUS_TO_PAYMENT_STATUS: Record<string, string> = {
  pending: "pending",
  complete: "verified",
  // 'cancel' is the ws_package_course_order spelling of what this table used to
  // store as 'failed' (2026-08-27). The WIRE value stays "failed" — the map is what
  // keeps the shipped response identical. 'failed' is kept as a key so a row written
  // before the enum change still resolves.
  cancel: "failed",
  failed: "failed",
};

const toVerifyDto = (sub: any | null, order: any): LiveCourseVerifyDto => ({
  _id: String(sub?.id ?? order.id),
  customerId: order.customerId,
  liveCourseId: order.liveCourseId,
  planId: order.planId ?? null,
  startAt: sub?.startAt ?? null,
  endAt: sub?.endAt ?? null,
  status: sub?.status ?? false,
  // `amount` is the charged amount (ws_live_course_order.discount_price).
  paidAmount: order.amount ?? null,
  paymentStatus: ORDER_STATUS_TO_PAYMENT_STATUS[order.status] ?? order.status ?? null,
  razorpayOrderId: order.razorpayOrderId ?? null,
  razorpayPaymentId: order.razorpayPaymentId ?? null,
  createdAt: sub?.createdAt ?? order.createdAt ?? null,
  updatedAt: sub?.updatedAt ?? order.updatedAt ?? null,
});

/** Read a live-course plan for create-order. Returns null if missing/zero-price. */
export const findLiveCoursePlanForOrder = async (
  planId: number
): Promise<{ liveCourseId: number; price: number; duration: number; withMaterial: boolean; materialPrice: number | null } | null> => {
  const plan = await prisma.liveCoursePlan.findFirst({
    where: { id: planId, status: true },
    select: { liveCourseId: true, price: true, duration: true, withMaterial: true, materialPrice: true },
  });
  if (!plan || !plan.price || plan.price <= 0) return null;
  return {
    liveCourseId: plan.liveCourseId,
    price: plan.price,
    duration: plan.duration ?? 0,
    withMaterial: !!plan.withMaterial,
    materialPrice: plan.materialPrice ?? null,
  };
};

/** Minimal live-course lookup (id + name + status) for SQL order responses.
 *  `status` lets create-order refuse a deactivated live course. */
export const findLiveCourse = (id: number) =>
  prisma.liveCourse.findFirst({ where: { id }, select: { id: true, name: true, status: true } });

/** All active pricing plans for a live course (apply-promo plan list). */
export const listPlansForLiveCourse = (liveCourseId: number) =>
  prisma.liveCoursePlan.findMany({
    where: { liveCourseId, status: true },
    orderBy: [{ isDefault: "desc" }, { price: "asc" }, { id: "asc" }],
  });

/**
 * The promo discount on a live-course subscription, DERIVED.
 *
 * ⚠ 2026-08-27: the discount is STORED again, in `ws_live_course_order.code_discount`
 * — the ws_package_course_order column. This function now PREFERS that column and
 * falls back to the derivation only for rows written before it existed. Keep both
 * paths: the admin customer-details DTO still reads legacy subscription rows.
 *
 * `ws_live_course_subscription.discount_amount` was dropped 2026-08-20 as redundant.
 * The legacy derivation is the exact inverse of what checkout used to write:
 *
 *   paid_amount = original_amount - discount - wallet_coin
 *
 * `original_amount` was set ONLY when a promo was applied (the same condition under
 * which `discount_amount` used to be non-NULL), so a NULL original means no promo and
 * therefore no discount. Wallet coin is subtracted out because it is redemption, not
 * a discount — it was never part of the stored value either.
 *
 * Both API readers (live-course receipt, admin customer-details DTO) call this, so
 * their responses are byte-identical to when the column existed. Keep the two in
 * sync: if the write formula ever changes, this must change with it.
 */
export const liveSubDiscountAmount = (sub: {
  codeDiscount?: number | null;
  originalPrice?: number | null;
  amount?: number | null;
  wsCoin?: number | null;
  /** Legacy ws_live_course_subscription columns (pre-2026-08-25 rows). */
  originalAmount?: number | null;
  paidAmount?: number | null;
  walletCoin?: number | null;
}): number => {
  // Since 2026-08-27 the discount is a real column (`code_discount`), exactly as on
  // ws_package_course_order — the derivation below is the LEGACY path, kept for rows
  // that predate it and for the subscription's own dropped columns.
  if (sub.codeDiscount != null) return Number(sub.codeDiscount) > 0 ? Number(sub.codeDiscount) : 0;

  const original = sub.originalPrice ?? sub.originalAmount;
  if (original == null) return 0;
  const paid = sub.amount ?? sub.paidAmount;
  const coin = sub.wsCoin ?? sub.walletCoin;
  const discount = Number(original) - Number(paid ?? 0) - Number(coin ?? 0);
  // Clamp: a hand-edited or partially-refunded row must not report a negative discount.
  return discount > 0 ? discount : 0;
};

/**
 * Create the pending live-course ORDER row + return its id. Nothing is granted yet:
 * no subscription row exists until the payment verifies, which is exactly why an
 * abandoned checkout can no longer leave an unverified row in the entitlement table.
 */
export const createLiveCourseOrderMysql = async (input: {
  customerId: number;
  liveCourseId: number;
  planId: number;
  /** Charged amount (post-promo, post-coin) → `discount_price`. */
  amount: number;
  razorpayOrderId: string;
  /** Business key (the receipt id) → `unique_id`. Mirrors the package/ebook paths. */
  uniqueId?: string | null;
  /** Full Razorpay order response, JSON string → `razorpay_order`. */
  razorpayOrderPayload?: string | null;
  /** Originating client IP → `ip_address` (utils/clientIp, clamped to the column). */
  ipAddress?: string | null;
  /** Referring CUSTOMER id → `referrer_id`, denormalised out of the snapshot. */
  referrerId?: number | null;
  /** Promo/referral discount in rupees → `code_discount`. 0 when no code. */
  codeDiscount?: number | null;
  /**
   * Purchase-time code snapshots from `buildOrderCodeSnapshots({..., planKind:
   * "livePlan"})`. Frozen objects, routed to exactly ONE column — a real promocode →
   * `promocode`, a customer referral code → `refferalcode` — mirroring
   * ws_package_course_order. Both null when no code was applied, or when the snapshot
   * could not be built — a snapshot never blocks a payment.
   *
   * These REPLACE the old `promocode_id` / `referrer_id` columns (dropped 2026-08-20):
   * the snapshot is now the single source of truth for who redeemed what, and the
   * referral credit at verify reads the referrer out of it (referrerIdOf below).
   */
  promocodeSnapshot?: unknown | null;
  refferalcodeSnapshot?: unknown | null;
  coin?: number | null;
  /**
   * Plan LIST price → `price`. ALWAYS written since 2026-08-27, matching
   * ws_package_course_order (`OrigianalPrice ?? price` in commerce-order.repository).
   * It used to be written only on a promo, because NULL was how "no promo" was
   * signalled to liveSubDiscountAmount; `codeDiscount` carries that explicitly now.
   */
  originalAmount?: number | null;
  /**
   * NOT persisted on the order any more (2026-08-27): ws_package_course_order has no
   * `with_material` column — material is a property of the PLAN
   * (ws_live_course_plan.with_material) and verify re-reads it from there. Still
   * accepted so the controller keeps one call shape, and still written to the
   * SUBSCRIPTION at verify.
   */
  withMaterial?: boolean;
  /** → `shipping` (was `customer_shipping_id`). ws_customer_shipping.id. */
  customerShippingId?: number | null;
  now: Date;
}): Promise<{ orderId: number }> => {
  const order = await prisma.liveCourseOrder.create({
    data: {
      customerId: input.customerId,
      liveCourseId: input.liveCourseId,
      planId: input.planId,
      uniqueId: input.uniqueId ?? null,
      orderType: "purchase",
      amount: Math.round(input.amount),
      originalPrice: Math.round(input.originalAmount ?? input.amount),
      codeDiscount: Math.round(input.codeDiscount ?? 0),
      // `?? Prisma.DbNull` (not `?? null`): on a Json column Prisma reads a bare
      // `null` as JsonNull — the JSON literal `null` INSIDE the column — whereas
      // DbNull is a real SQL NULL. The report treats SQL NULL as "no code"; a JSON
      // null would be a non-empty value that every JSON_EXTRACT path then misses.
      promocode: (input.promocodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
      refferalcode: (input.refferalcodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
      referrerId: input.referrerId ?? null,
      wsCoin: input.coin ?? 0,
      paymentMethod: "online",
      status: "pending",
      shipping: input.customerShippingId ?? null,
      razorpayOrderId: input.razorpayOrderId,
      razorpayOrder: input.razorpayOrderPayload ?? null,
      ipAddress: input.ipAddress ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
  return { orderId: order.id };
};

/**
 * The referring CUSTOMER's id, read out of the frozen referral snapshot.
 *
 * ⚠ 2026-08-27: `referrer_id` is a real column again (ws_package_course_order has
 * one), and checkout now writes it. This stays the FALLBACK for rows written between
 * 2026-08-20 and 2026-08-27, when the snapshot was the only source — see the
 * `order.referrerId ?? referrerIdOf(order)` call in verify.
 *
 * ⚠ In the legacy referral shape the key `promoter` holds the referring CUSTOMER
 * (not a ws_promoter), so the id lives at `$.refferalcode.promoter.id` — the same
 * value `referrer_id` used to carry. A promocode snapshot has no referrer at all and
 * correctly yields null, so promocode purchases never credit anyone.
 *
 * Returns null for pre-2026-08-20 rows that were never backfilled; creditReferrer
 * treats a null referrer as "nothing to credit" and is a no-op.
 */
const referrerIdOf = (row: { refferalcode: unknown }): number | null => {
  const ref = row.refferalcode as any;
  const id = ref && typeof ref === "object" ? ref.promoter?.id : null;
  return Number.isInteger(id) && id > 0 ? (id as number) : null;
};

/**
 * Promoter attribution for the subscription's `promoter_id` / `promoter_percentage`
 * columns, denormalised out of the order's frozen promocode snapshot.
 *
 * The two JSON paths are exactly the ones `modules/promoter-data` already filters the
 * PACKAGE promoter dashboard on (`$.promoterId`,
 * `$.promotedPackageCourseEbook[0].promoterPercentage`), so live-course rows now carry
 * the same attribution package rows do — and it is a COLUMN here, so the live-course
 * reports do not need a JSON_EXTRACT to find it.
 *
 * ⚠ A REFERRAL snapshot deliberately yields nothing. In the legacy referral shape the
 * key `promoter` holds the referring CUSTOMER, not a `ws_promoter` — the same trap
 * `subCodeInfo` in admin-live-course.service documents. Attributing one as the other
 * would book customer referral rewards as promoter commission.
 */
const promoterAttribution = (row: {
  promocode?: unknown;
}): { promoterId: number | null; promoterPercentage: number | null } => {
  const promo = row.promocode as any;
  if (!promo || typeof promo !== "object") return { promoterId: null, promoterPercentage: null };

  const id = promo.promoterId;
  const pct = Array.isArray(promo.promotedPackageCourseEbook)
    ? promo.promotedPackageCourseEbook[0]?.promoterPercentage
    : null;
  const pctNum = pct != null && pct !== "" ? Number(pct) : null;

  return {
    promoterId: Number.isInteger(id) && id > 0 ? (id as number) : null,
    promoterPercentage: pctNum != null && Number.isFinite(pctNum) ? pctNum : null,
  };
};

/** Owner lookup for verify (the order owning this razorpay order id). */
export const findLiveCourseOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
) => prisma.liveCourseOrder.findFirst({ where: { razorpayOrderId, customerId } });

/**
 * Verify fulfillment. Idempotent: an order that is no longer "pending" returns its
 * existing subscription untouched.
 *
 * Otherwise, in ONE transaction: the order flips to "complete" and a NEW
 * subscription row is created for it. A renewal continues from the customer's
 * current entitlement (`startAt = existing.endAt` when that is still in the future,
 * else now) and leaves that row alone — the pre-2026-08-25 behaviour folded the
 * window onto it and retired the pending row instead, which is why a renewal's
 * payment had nowhere of its own to live.
 *
 * `duration` is DAYS — see [[project_plan_duration_unit]].
 */
export const verifyLiveCourseOrderMysql = async (
  order: any,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<LiveCourseVerifyDto> => {
  // Idempotency: the order already ran. Return the subscription it produced.
  if (order.status && order.status !== "pending") {
    const existingSub = await prisma.liveCourseSubscription.findFirst({ where: { orderId: order.id } });
    return toVerifyDto(existingSub, order);
  }

  // `withMaterial` is read from the PLAN, not the order: ws_package_course_order has
  // no with_material column and neither does this table since 2026-08-27. It was
  // never a free checkout choice — the controller set it from this same plan flag.
  const plan = await prisma.liveCoursePlan.findFirst({
    where: { id: order.planId ?? 0 },
    select: { duration: true, withMaterial: true, materialPrice: true },
  });
  const durationDays = plan?.duration ?? 0;
  const withMaterial = !!plan?.withMaterial;
  const amount = order.amount ?? 0;

  // ── the ws_package_course_subscription columns, sourced the same way ────────
  // Money split: shared helper, so live course and package book it identically.
  const material = computeMaterialSplit(amount, plan);
  // The entitled material kit, copied off the live course — the twin of
  // findCoursePcMaterialId / findPackagePcMaterialId on the package path.
  const liveCourseRow = await prisma.liveCourse.findFirst({
    where: { id: order.liveCourseId },
    select: { pcMaterialId: true },
  });
  // Promoter attribution, denormalised out of the order's frozen promocode snapshot.
  const promoter = promoterAttribution(order);

  // The customer's current entitlement for this live course, read ONLY to place the
  // new window. `endAt: null` is a lifetime grant, which cannot be continued from —
  // it never ends — so such a row falls through to `now` like a lapsed one.
  const existingActive = await prisma.liveCourseSubscription.findFirst({
    where: {
      customerId: order.customerId,
      liveCourseId: order.liveCourseId,
      status: true,
      OR: [{ endAt: null }, { endAt: { gte: now } }],
    },
    orderBy: { endAt: "desc" },
  });
  const startAt =
    existingActive?.endAt && existingActive.endAt.getTime() > now.getTime()
      ? existingActive.endAt
      : now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });

  const sub = await prisma.$transaction(async (tx) => {
    await tx.liveCourseOrder.update({
      where: { id: order.id },
      // `paid_at` is gone (2026-08-27) — `updated_at` IS the paid-at on an order
      // table, which is where the package receipt has always read it. Verify already
      // wrote both with the same `now`, so no reader's value changes.
      data: { status: "complete", razorpayPaymentId, updatedAt: now },
    });

    // Shipment tracking now lives in ws_live_course_subscription_tracking, the twin of
    // ws_package_course_subscription_tracking (2026-08-27 (c)) — created BEFORE the
    // subscription so its id can go straight onto the row, exactly as verifyCourseTx
    // does it. That id is also the AWB (courierForAwb routes on it). ONLY material
    // purchases get a row; digital-only subs keep tracking null.
    //
    // ⚠ `orderId` here is the ORDER id, not the subscription id — same as the
    // reference table.
    const trackingRow = withMaterial
      ? await tx.liveCourseSubscriptionTracking.create({
          data: { orderId: order.id, status: "pending", created_at: now, updated_at: now },
        })
      : null;

    const created = await tx.liveCourseSubscription.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        liveCourseId: order.liveCourseId,
        planId: order.planId ?? null,
        startAt,
        endAt,
        status: true,
        // Material comes from the plan; the entitlement row stores it so dispatch +
        // access checks stay row-local (the order no longer carries a copy).
        withMaterial,
        shipping: order.shipping ?? null,
        tracking: trackingRow?.id ?? null,
        pcMaterialId: liveCourseRow?.pcMaterialId ?? null,
        // Money mirrored off the order so the subscription reports stand alone, split
        // exactly as package splits it. course + material always sums back to amount.
        amount,
        courseAmount: material.courseAmount,
        materialAmount: material.materialAmount,
        paidAmount: new Prisma.Decimal(amount),
        // A gateway id means the customer paid online; an admin grant writes "backend".
        payment_type: order.razorpayOrderId ? "online" : "backend",
        promoterId: promoter.promoterId,
        promoterPercentage:
          promoter.promoterPercentage != null ? new Prisma.Decimal(promoter.promoterPercentage) : null,
        createdAt: now,
        updatedAt: now,
      },
    });

    // No second write: the AWB is the tracking row's id, which exists before the
    // subscription is inserted. (It used to be the subscription's own id, which could
    // only be known after the insert.)
    return created;
  });

  // Referral credit + wallet debit are keyed to the ORDER id (the payment record).
  // Both are idempotent and non-throwing — neither may block fulfilment.
  // `referrer_id` is a column again since 2026-08-27; the snapshot read is the
  // fallback for rows written while it did not exist.
  await creditReferrer({ referrerId: order.referrerId ?? referrerIdOf(order), buyerId: order.customerId, orderId: order.id, paidAmount: amount, source: "liveCourse" });
  await debitWallet({ customerId: order.customerId, orderId: order.id, coin: order.wsCoin, source: "liveCourse" });
  return toVerifyDto(sub, { ...order, status: "complete", razorpayPaymentId, updatedAt: now });
};

/**
 * Webhook fulfillment (paymentWebhook). The webhook arrives independently of the
 * client /verify call; same fulfilment, keyed by razorpayOrderId ALONE (the razorpay
 * payload carries no customer). Idempotent + safe to run before or after /verify.
 * Returns null if no SQL order owns this id (→ caller falls through).
 */
export const fulfillLiveCourseWebhookMysql = async (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<LiveCourseVerifyDto | null> => {
  const order = await prisma.liveCourseOrder.findFirst({ where: { razorpayOrderId } });
  if (!order) return null;
  return verifyLiveCourseOrderMysql(order, razorpayPaymentId, now);
};
