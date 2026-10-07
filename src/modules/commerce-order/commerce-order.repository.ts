// Course/package orders: Prisma queries and the fulfilment transaction.
import { prisma } from "../../config/prisma";
import { Prisma } from "@prisma/client";
import type {
  PromocodeSnapshot,
  ReferralSnapshot,
} from "../order-code-snapshot/order-code-snapshot.types";

/**
 * Physical-material split written onto a fresh subscription (PC_MATERIAL_SUBSCRIPTION_FLOW).
 *  - courseAmount   : digital portion (always set; = full paid amount when no material)
 *  - materialAmount : physical portion, residual of (paid − course); null when no material
 *  - pcMaterialId   : the entitled material kit copied from the Course/Package; null when no material
 *  - withMaterial   : gates whether a tracking (dispatch) row is created at all — one is
 *    created ONLY for material plans; digital-only subs get no tracking row (trackingId null)
 */
export type MaterialFulfillment = {
  courseAmount: number;
  materialAmount: number | null;
  pcMaterialId: number | null;
  withMaterial: boolean;
};

/**
 * Fulfillment is a single transaction so a mid-write crash can't leave a complete order with
 * no entitlement. `customer_id` is VARCHAR on the order table and INT on the subscription
 * table (see types.ts).
 */
export const commerceOrderRepository = {
  /** Scoped to the customer; the service confirms the plan kind. */
  findOrderByRazorpay: (razorpayOrderId: string, customerIdStr: string) =>
    prisma.packageCourseOrder.findFirst({
      where: { gatewayOrderId: razorpayOrderId, userId: Number(customerIdStr) },
    }),

  findPlan: (planId: number) =>
    prisma.packageCourseEbookPrice.findUnique({
      where: { id: planId },
      select: {
        id: true,
        courseId: true,
        packageId: true,
        duration: true,
        price: true,
        status: true,
        withMaterial: true,
        materialPrice: true,
      },
    }),

  findCoursePcMaterialId: async (courseId: number): Promise<number | null> => {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { pcMaterialId: true },
    });
    return course?.pcMaterialId ?? null;
  },

  findPackagePcMaterialId: async (packageId: number): Promise<number | null> => {
    const pkg = await prisma.package.findUnique({
      where: { id: packageId },
      select: { pcMaterialId: true },
    });
    return pkg?.pcMaterialId ?? null;
  },

  /** `status=true` is the verified-entitlement gate; payment status lives on the order row. */
  findActiveCourseSub: (
    customerId: number,
    courseId: number,
    excludeSubId: number | null,
    now: Date
  ) =>
    prisma.packageCourseSubscription.findFirst({
      where: {
        customerId,
        courseId,
        status: true,
        ...(excludeSubId ? { id: { not: excludeSubId } } : {}),
        OR: [{ endAt: null }, { endAt: { gte: now } }],
      },
      orderBy: { endAt: "desc" },
    }),

  findSubByOrder: (orderId: number) =>
    prisma.packageCourseSubscription.findFirst({ where: { orderId } }),

  /** course_id NULL so a course sub for a bundled course can't be mistaken for the package entitlement. */
  findActivePackageSub: (
    customerId: number,
    packageId: number,
    excludeSubId: number | null,
    now: Date
  ) =>
    prisma.packageCourseSubscription.findFirst({
      where: {
        customerId,
        packageId,
        courseId: null,
        status: true,
        ...(excludeSubId ? { id: { not: excludeSubId } } : {}),
        OR: [{ endAt: null }, { endAt: { gte: now } }],
      },
      orderBy: { endAt: "desc" },
    }),

  /** Twin of verifyCourseTx; the sub row sets `packageId` with `courseId: null`. */
  verifyPackageTx: (input: {
    orderId: number;
    razorpayPaymentId: string;
    customerId: number;
    packageId: number;
    planId: number | null;
    amount: number;
    now: Date;
    material: MaterialFulfillment;
    startAt: Date;
    endAt: Date;
    extended: boolean;
  }) =>
    prisma.$transaction(async (tx) => {
      // Claim the order: only a still-pending row flips. /verify and the Razorpay
      // webhook (or a retried /verify) can arrive together; the loser matches 0
      // rows, writes nothing and returns null, so one order never yields two
      // subscriptions or two kit dispatches.
      const claim = await tx.packageCourseOrder.updateMany({
        where: { id: input.orderId, status: "pending" },
        data: { status: "complete", gatewayPaymentId: input.razorpayPaymentId },
      });
      if (claim.count === 0) return null;
      const order = await tx.packageCourseOrder.findUniqueOrThrow({ where: { id: input.orderId } });

      // Dispatch (tracking) row only for material plans; a with-material renewal ships a new kit.
      const tracking = input.material.withMaterial
        ? await tx.packageCourseSubscriptionTracking.create({
            data: { orderId: input.orderId, status: "pending" },
          })
        : null;
      const sub = await tx.packageCourseSubscription.create({
        data: {
          customerId: input.customerId,
          orderId: input.orderId,
          packageId: input.packageId,
          courseId: null,
          planId: input.planId,
          pcMaterialId: input.material.pcMaterialId,
          // Dispatch address captured at order time (null for digital-only).
          shippingId: order.shipping ?? undefined,
          trackingId: tracking?.id ?? undefined,
          startAt: input.startAt,
          endAt: input.endAt,
          amount: new Prisma.Decimal(input.amount),
          courseAmount: new Prisma.Decimal(input.material.courseAmount),
          materialAmount:
            input.material.materialAmount != null
              ? new Prisma.Decimal(input.material.materialAmount)
              : null,
          status: true,
          payment_type: "online",
          // created_at has no DB default; without it purchase-history purchasedAt is null.
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { order, subscription: sub, extended: input.extended };
    }),

  /**
   * MONEY COLUMN CONTRACT (the three columns must always satisfy this identity):
   *
   *   price − code_discount − ws_coin  =  discount_price
   *
   *  - `OrigianalPrice` (SQL `price`)          = the plan's LIST price, before any
   *    promo/referral discount and before wallet redemption. Never the charged amount.
   *  - `codeDiscount` (SQL `code_discount`)    = rupees knocked off by the promo /
   *    referral code ONLY (0 when no code). Wallet coins are NOT folded in here —
   *    they are recorded separately in `ws_coin`, so the two discount sources stay
   *    individually attributable in the Subscription Report.
   *  - `amount` (SQL `discount_price`)         = what the customer actually paid,
   *    i.e. what was charged to Razorpay (post-promo AND post-coin).
   *
   * CODE COLUMNS: `promocode` / `refferalcode` hold the purchase-time snapshot object built by
   * `modules/order-code-snapshot`; exactly one is ever set. The object is a READ CONTRACT:
   * `modules/promoter-data` reads it via JSON paths (`$.promoterId`,
   * `$.promotedPackageCourseEbook[0].promoterPercentage`), so a bare code string would make the
   * order invisible to promoter attribution. Never flatten these.
   *
   * `shippingId` is the kit dispatch address for "With Materials" plans; null for digital-only.
   */
  createPendingOrder: (input: {
    customerId: number;
    planId: number;
    /** Charged amount → `discount_price` (post-promo, post-coin). */
    price: number;
    /** Plan list price → `price`. Falls back to `price` when the caller omits it. */
    originalPrice?: number | null;
    /** Promo/referral discount in rupees → `code_discount`. 0/null when no code. */
    codeDiscount?: number | null;
    /** Promocode snapshot object → `promocode` (null for referral / no code). */
    promoCode?: PromocodeSnapshot | null;
    /** Referral snapshot object → `refferalcode` (null for promocode / no code). */
    referralCode?: ReferralSnapshot | null;
    razorpayOrderId: string;
    // Receipt id → unique_id; full Razorpay order response (JSON string) → razorpay_order.
    uniqueId?: string | null;
    razorpayOrderPayload?: string | null;
    shippingId?: number | null;
    referrerId?: number | null;
    coin?: number | null;
  }) =>
    prisma.packageCourseOrder.create({
      data: {
        uniqueId: input.uniqueId ?? null,
        userId: input.customerId,
        planId: input.planId,
        orderType: "purchase",
        paymentMethod: "razorpay",
        OrigianalPrice: Math.round(input.originalPrice ?? input.price),
        codeDiscount: Math.round(input.codeDiscount ?? 0),
        amount: Math.round(input.price),
        promocode: input.promoCode ?? Prisma.DbNull,
        refferalcode: input.referralCode ?? Prisma.DbNull,
        gatewayOrderId: input.razorpayOrderId,
        gatewayOrder: input.razorpayOrderPayload ?? null,
        shipping: input.shippingId ?? undefined,
        referrerId: input.referrerId ?? null,
        wsCoin: input.coin ?? null,
        status: "pending",
        // No DB default on these columns; they would land NULL otherwise.
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),

  /**
   * One $transaction: flip the order → complete, then create THIS order's subscription row +
   * tracking row (tracking `order` = order.id, not subscription.id).
   *
   * ONE ORDER = ONE SUBSCRIPTION ROW: a renewal writes its own row starting where the previous
   * one ends, so each purchase keeps its own price, plan, material split and dispatch record.
   * Readers dedupe per target keeping the furthest endAt (client-my-subscriptions,
   * profile-dashboard, client-dashboard), so stacked rows present as one card.
   */
  verifyCourseTx: (input: {
    orderId: number;
    razorpayPaymentId: string;
    customerId: number;
    courseId: number;
    planId: number | null;
    amount: number;
    now: Date;
    material: MaterialFulfillment;
    startAt: Date;
    endAt: Date;
    // Reported back to the caller only; it does NOT change what is written.
    extended: boolean;
  }) =>
    prisma.$transaction(async (tx) => {
      // Claim the order: only a still-pending row flips. /verify and the Razorpay
      // webhook (or a retried /verify) can arrive together; the loser matches 0
      // rows, writes nothing and returns null, so one order never yields two
      // subscriptions or two kit dispatches.
      const claim = await tx.packageCourseOrder.updateMany({
        where: { id: input.orderId, status: "pending" },
        data: { status: "complete", gatewayPaymentId: input.razorpayPaymentId },
      });
      if (claim.count === 0) return null;
      const order = await tx.packageCourseOrder.findUniqueOrThrow({ where: { id: input.orderId } });

      // Dispatch (tracking) row only for material plans; a with-material renewal ships a new kit.
      const tracking = input.material.withMaterial
        ? await tx.packageCourseSubscriptionTracking.create({
            data: { orderId: input.orderId, status: "pending" },
          })
        : null;
      const sub = await tx.packageCourseSubscription.create({
        data: {
          customerId: input.customerId,
          orderId: input.orderId,
          courseId: input.courseId,
          planId: input.planId,
          pcMaterialId: input.material.pcMaterialId,
          // Dispatch address captured at order time (null for digital-only).
          shippingId: order.shipping ?? undefined,
          trackingId: tracking?.id ?? undefined,
          startAt: input.startAt,
          endAt: input.endAt,
          amount: new Prisma.Decimal(input.amount),
          courseAmount: new Prisma.Decimal(input.material.courseAmount),
          materialAmount:
            input.material.materialAmount != null
              ? new Prisma.Decimal(input.material.materialAmount)
              : null,
          status: true,
          payment_type: "online",
          // created_at has no DB default; without it purchase-history purchasedAt is null.
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { order, subscription: sub, extended: input.extended };
    }),
};
