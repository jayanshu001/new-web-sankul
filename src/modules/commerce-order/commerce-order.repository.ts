import { prisma } from "../../config/prisma";
import { Prisma } from "@prisma/client";
import type {
  PromocodeSnapshot,
  ReferralSnapshot,
} from "../order-code-snapshot/order-code-snapshot.types";

/**
 * Physical-material split written onto a fresh subscription (PC_MATERIAL_SUBSCRIPTION_FLOW).
 * Computed by the service from the paid amount + plan; the repo just persists it.
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
 * Prisma persistence for the commerce · order WRITE branch (Phase 3b, COURSE
 * path). Tables: `ws_package_course_order` (the order-of-record),
 * `ws_package_course_subscription` (the entitlement), and
 * `ws_package_course_subscription_tracking` (status trail).
 *
 * Reads here serve the verify owner-lookup + the upsert-extend active-sub query.
 * Writes are exposed as a single transactional fulfillment (`verifyCourseTx`) so
 * a mid-write crash can't leave a complete order with no entitlement.
 *
 * `customer_id` TYPE SPLIT: the order table is VARCHAR, the subscription table is
 * INT (see types.ts). Callers pass the int customer id; we cast to string for the
 * order-row queries/writes.
 */
export const commerceOrderRepository = {
  // ── reads (owner lookup + upsert-extend) ──────────────────────────────────

  /**
   * The course order owning this Razorpay order id, scoped to the customer.
   * Mirrors the Mongo `PackageCourseSubscription.findOne({razorpayOrderId,
   * customerId})` owner lookup — but in SQL the razorpay id lives on the ORDER
   * row. Only course orders qualify: a course order's matching subscription (once
   * created) has a non-null course_id; at order time we tell course-vs-ebook
   * apart by the plan, but for the lookup we simply return the order row and let
   * the service confirm the plan is a course plan.
   */
  findOrderByRazorpay: (razorpayOrderId: string, customerIdStr: string) =>
    prisma.packageCourseOrder.findFirst({
      where: { gatewayOrderId: razorpayOrderId, userId: Number(customerIdStr) },
    }),

  /**
   * A plan row (PackageCourseEbookPrice) — to read its course_id + duration, plus
   * the material facts (`with_material` / `material_price`) the verify path needs
   * to split the paid amount into course/material portions.
   */
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

  /**
   * The material kit (`pc_material_id`) the customer is entitled to — copied from
   * the purchased Course onto the subscription when the plan has material. Null if
   * the course has no material kit configured.
   */
  findCoursePcMaterialId: async (courseId: number): Promise<number | null> => {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { pcMaterialId: true },
    });
    return course?.pcMaterialId ?? null;
  },

  /** Twin of findCoursePcMaterialId for PACKAGE plans (reads ws_package). */
  findPackagePcMaterialId: async (packageId: number): Promise<number | null> => {
    const pkg = await prisma.package.findUnique({
      where: { id: packageId },
      select: { pcMaterialId: true },
    });
    return pkg?.pcMaterialId ?? null;
  },

  /**
   * The customer's existing ACTIVE verified course subscription for the same
   * course (for upsert-extend). Mirrors the Mongo target filter:
   *   {_id≠self, customerId, status:true, paymentStatus:"verified", courseId}
   * In SQL `status=true` IS the verified-entitlement gate (no payment_status
   * column on the subscription table — that lives on the order row).
   */
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

  /** The subscription created for a given order (idempotency re-entry). */
  findSubByOrder: (orderId: number) =>
    prisma.packageCourseSubscription.findFirst({ where: { orderId } }),

  /**
   * PACKAGE upsert-extend twin of findActiveCourseSub. The customer's existing
   * ACTIVE verified PACKAGE subscription for the same package — gated by
   * package_id (and course_id NULL, so a course sub for a bundled course can't be
   * mistaken for the package entitlement). `status=true` is the verified gate.
   */
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

  /**
   * PACKAGE transactional fulfillment — twin of verifyCourseTx, but the sub row
   * sets `packageId` (the target package) with `courseId: null`, mirroring the
   * Mongo package sub (targetPackageId set, courseId unset). Plan id → pcb_id.
   * Same one-order-one-row rule as verifyCourseTx — renewals never fold.
   */
  verifyPackageTx: (input: {
    orderId: number;
    razorpayPaymentId: string;
    customerId: number;
    packageId: number;
    planId: number | null;
    amount: number;
    now: Date;
    material: MaterialFulfillment;
    // Window for THIS purchase (see verifyCourseTx). Renewal → continues from the
    // prior row's endAt; first purchase → starts now. Always writes a NEW row.
    startAt: Date;
    endAt: Date;
    extended: boolean;
  }) =>
    prisma.$transaction(async (tx) => {
      const order = await tx.packageCourseOrder.update({
        where: { id: input.orderId },
        data: { status: "complete", gatewayPaymentId: input.razorpayPaymentId },
      });

      // A tracking row (the dispatch record) is created ONLY for material plans —
      // the kit still has to ship, so status starts "pending". "Without Material" /
      // digital-only orders have nothing to dispatch, so no tracking row is created
      // and trackingId stays null. Renewals included — a with-material renewal
      // ships a NEW kit and gets its own dispatch row.
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
          // Material kit + price split — copied from the package when the plan
          // carries material; null/full-course otherwise (see MaterialFulfillment).
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
          // ws_package_course_subscription.created_at has NO DB default (introspected
          // legacy table) — set it explicitly or purchase-history purchasedAt is null.
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { order, subscription: sub, extended: input.extended };
    }),

  // ── write: create the pending order row (create-order endpoint) ────────────

  /**
   * Create a pending course order. customerId is an int; cast to string for the
   * VARCHAR order column.
   *
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
   * CODE COLUMNS: `promocode` / `refferalcode` are `json` columns holding the
   * purchase-time SNAPSHOT of the redeemed code — the full legacy object (nested
   * promoter + the purchased plan's link row), built by
   * `modules/order-code-snapshot`. Exactly one of the two is ever set: a real
   * promocode → `promocode`, a customer referral code → `refferalcode`.
   *
   * ⚠ The object is a READ CONTRACT, not a convenience. `modules/promoter-data`
   * derives the promoter dashboard straight off these columns via JSON paths
   * (`$.promoterId`, `$.promotedPackageCourseEbook[0].promoterPercentage`), so a
   * bare code string — while a perfectly valid json value — matches none of them
   * and makes the order invisible to promoter attribution. Never flatten these.
   *
   * `shippingId` (the chosen CustomerShipping address) is persisted on the order
   * row for "With Materials" plans so the physical kit has a dispatch address;
   * null/undefined for digital-only orders.
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
    // Business key (the receipt id) → unique_id; full Razorpay order response
    // (JSON string) → razorpay_order. Mirrors the ebook/book order create paths.
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
        // Explicit stamps: the ws_package_course_order columns have no DB default,
        // so created_at/updated_at would land NULL on new rows otherwise (mirrors
        // the ebook-order create path).
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),

  // ── write: verify fulfillment (ONE transaction) ───────────────────────────

  /**
   * Transactional course fulfillment. Within one $transaction:
   *  1. flip the order row → complete + razorpay_payment_id
   *  2. create the subscription row for THIS order + its tracking row
   * The tracking row's `order` column = order.id (NOT subscription.id).
   *
   * ONE ORDER = ONE SUBSCRIPTION ROW. A renewal does NOT fold onto the customer's
   * existing row: it writes its own row starting where the previous one ends, so
   * every purchase keeps its own price, plan, material split and dispatch record,
   * and `order_id` on a row always points at the order that paid for it. Readers
   * dedupe per target keeping the furthest endAt (client-my-subscriptions.service,
   * profile-dashboard.sql, client-dashboard.service), so a stack of rows presents
   * as one card with the extended date.
   *
   * `now` and the window are computed by the service (DAYS planDuration) and
   * passed in — the repo stays IO-only.
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
    // The window for THIS purchase, computed by the service. A renewal continues
    // from the prior row's endAt; a first purchase starts now. Either way the row
    // written below is a NEW one — see the `extended` note in the doc block.
    startAt: Date;
    endAt: Date;
    // True when this purchase continues an existing entitlement. Reported back for
    // the caller's benefit only — it does NOT change what is written.
    extended: boolean;
  }) =>
    prisma.$transaction(async (tx) => {
      const order = await tx.packageCourseOrder.update({
        where: { id: input.orderId },
        data: { status: "complete", gatewayPaymentId: input.razorpayPaymentId },
      });

      // A tracking row (the dispatch record) is created ONLY for material plans —
      // there's a physical kit to ship, so status starts "pending". "Without
      // Material" / digital-only subs have nothing to dispatch, so no tracking row
      // is created and trackingId stays null. This runs for renewals too: a
      // with-material renewal ships a NEW kit, so it gets its own dispatch row.
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
          // Material kit + price split — copied from the course when the plan
          // carries material; null/full-course otherwise (see MaterialFulfillment).
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
          // ws_package_course_subscription.created_at has NO DB default (introspected
          // legacy table) — set it explicitly or purchase-history purchasedAt is null.
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { order, subscription: sub, extended: input.extended };
    }),
};
