import { Prisma } from "@prisma/client";
import type { TestSeriesOrder, TestSeriesSubscription } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { extractPromoterAttribution } from "../order-code-snapshot/order-code-snapshot.service";
import { computeEndAt } from "../../utils/planDuration";
import { creditReferrer } from "../../client/referral/credit-referrer";
import { debitWallet } from "../../client/referral/debit-wallet";

/**
 * Test-series payment + subscription write path on SQL (Wave 7 — net-new tables
 * ws_test_series / _price / _order / _subscription). Mirrors the live-course-order
 * shape but with a separate ws_test_series_order table (3-ish-table: order →
 * subscription at verify, no tracking row).
 *
 * ⚠ price-plan duration is DAYS (durationDays column; computeEndAt asDays:true).
 * Idempotent verify + dual-read fallback (SQL first, Mongo on miss).
 */
export const TEST_SERIES_ORDER_MODULE = "test-series-order";
export const isTestSeriesOrderMysql = (): boolean => true;

export const parseTsId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const num = (v: any): number => (v == null ? 0 : Number(v.toString?.() ?? v) || 0);

// ── reads for apply-promo / create-order ──────────────────────────────────────
export const findPlanForOrder = async (planId: number) => {
  const plan = await prisma.testSeriesPrice.findFirst({ where: { id: planId, status: true } });
  if (!plan) return null;
  const price = num(plan.price);
  if (price <= 0) return null;
  return { id: plan.id, testSeriesId: plan.testSeriesId, durationDays: plan.durationDays, price, originalPrice: plan.originalPrice != null ? num(plan.originalPrice) : null };
};

export const findSeries = (id: number) =>
  prisma.testSeries.findFirst({ where: { id, status: true }, select: { id: true, title: true } });

/** All active pricing plans for a test series (apply-promo plan list). */
export const listPlansForSeries = (testSeriesId: number) =>
  prisma.testSeriesPrice.findMany({ where: { testSeriesId, status: true }, orderBy: { durationDays: "asc" } });

// ── create-order (write pending ws_test_series_order) ─────────────────────────
export const createOrderMysql = async (input: {
  customerId: number; testSeriesId: number; planId: number;
  bd: { basePrice: number; discountAmount: number; gstAmount: number; handlingFee: number; totalAmount: number };
  promocodeId: number | null; razorpayOrderId: string; referrerId?: number | null; coin?: number | null;
  /**
   * The four values this checkout already computed but had nowhere to put before the
   * table took the ws_package_course_order shape (2026-08-31):
   *   uniqueId             → unique_id      (the receipt id already returned to the client)
   *   razorpayOrderPayload → razorpay_order (the full gateway response)
   *   ipAddress            → ip_address     (the column existed but nothing wrote it)
   *   promocode/refferalcode snapshots → the two json columns
   * Same wiring as createPackageOrderMysql and createLiveCourseOrderMysql.
   */
  uniqueId?: string | null;
  razorpayOrderPayload?: string | null;
  ipAddress?: string | null;
  promocodeSnapshot?: unknown | null;
  refferalcodeSnapshot?: unknown | null;
}, now: Date = new Date()): Promise<{ orderId: number }> => {
  const o = await prisma.testSeriesOrder.create({ data: {
    customerId: input.customerId, testSeriesId: input.testSeriesId, planId: input.planId,
    uniqueId: input.uniqueId ?? null,
    paymentMethod: "razorpay", orderType: "purchase",
    // Package names since 2026-08-31: amount = discount_price (charged),
    // originalPrice = price (plan list), codeDiscount = code_discount, wsCoin = ws_coin.
    amount: Math.round(input.bd.totalAmount),
    originalPrice: input.bd.basePrice,
    codeDiscount: Math.round(input.bd.discountAmount),
    wsCoin: input.coin ?? 0,
    promocodeId: input.promocodeId,
    // `?? Prisma.DbNull` (not `?? null`): on a Json column Prisma reads a bare `null`
    // as JsonNull — the JSON literal `null` INSIDE the column — whereas DbNull is a
    // real SQL NULL. promoter-data treats SQL NULL as "no code"; a JSON null would be
    // a non-empty value that every JSON_EXTRACT path then misses.
    promocode: (input.promocodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
    refferalcode: (input.refferalcodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
    referrerId: input.referrerId ?? null,
    razorpayOrderId: input.razorpayOrderId,
    razorpayOrder: input.razorpayOrderPayload ?? null,
    ipAddress: input.ipAddress ?? null,
    status: "pending",
    // created_at/updated_at have no DB default (introspected legacy table) — set them
    // or the row reads back null, renders "—" in the admin Orders tab and sorts
    // unpredictably under `orderBy createdAt desc`. Same hazard as the subscription
    // create below; the admin grant path (admin-testseries.service) already does this.
    createdAt: now, updatedAt: now,
  }});
  return { orderId: o.id };
};

// ── verify owner lookup + fulfillment ─────────────────────────────────────────
export const findOrderForVerify = (razorpayOrderId: string, customerId: number) =>
  prisma.testSeriesOrder.findFirst({ where: { razorpayOrderId, customerId } });

export type TsVerifyDto = {
  _id: string; customerId: number; testSeriesId: number; planId: number | null;
  startAt: Date | null; endAt: Date | null; status: boolean; price: number;
  orderId: number; razorpayOrderId: string | null; razorpayPaymentId: string | null;
};

// Typed, NOT `any`: the params used to be `any`, which is how the 2026-08-31
// `price` → `amount` rename slipped past tsc here and would have made the verify
// response's `price` read 0 on every purchase. The wire key stays `price`.
const toDto = (sub: TestSeriesSubscription, order: TestSeriesOrder): TsVerifyDto => ({
  _id: String(sub.id), customerId: sub.customerId, testSeriesId: sub.testSeriesId, planId: sub.planId ?? null,
  startAt: sub.startAt ?? null, endAt: sub.endAt ?? null, status: sub.status, price: num(sub.amount),
  orderId: order.id, razorpayOrderId: order.razorpayOrderId ?? null, razorpayPaymentId: order.razorpayPaymentId ?? null,
});

export const verifyOrderMysql = async (order: any, razorpayPaymentId: string, now: Date = new Date()): Promise<TsVerifyDto> => {
  // Idempotency: order already complete → return its existing subscription.
  if (order.status !== "pending") {
    const existing = await prisma.testSeriesSubscription.findFirst({ where: { orderId: order.id } });
    if (existing) return toDto(existing, order);
  }
  const plan = order.planId ? await prisma.testSeriesPrice.findFirst({ where: { id: order.planId }, select: { durationDays: true } }) : null;
  const durationDays = plan?.durationDays ?? 0;
  const orderPrice = num(order.amount);

  const existingActive = await prisma.testSeriesSubscription.findFirst({
    where: { customerId: order.customerId, testSeriesId: order.testSeriesId, status: true, endAt: { gt: now } },
    orderBy: { endAt: "desc" },
  });

  // ONE ORDER = ONE SUBSCRIPTION ROW. `existingActive` only places the window: a
  // renewal starts where the current entitlement ends, otherwise now. The existing
  // row is never touched — it keeps its own price and its own order_id.
  const startAt =
    existingActive?.endAt && existingActive.endAt.getTime() > now.getTime()
      ? existingActive.endAt
      : now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });

  const promoter = extractPromoterAttribution(order);

  const result = await prisma.$transaction(async (tx) => {
    const o = await tx.testSeriesOrder.update({ where: { id: order.id }, data: { status: "complete", razorpayPaymentId, updatedAt: now } });
    const sub = await tx.testSeriesSubscription.create({
      // created_at has no DB default (introspected legacy table) — set it or the row is
      // invisible to created_at-windowed reads (admin dashboard, purchase history).
      // `amount` is THIS order's charge, never a running total: the row is its own
      // purchase record, so summing would double-count it against its own order.
      // (`price` until 2026-08-31 — renamed onto the package column name.)
      data: {
        orderId: o.id, customerId: o.customerId, testSeriesId: o.testSeriesId, planId: o.planId,
        amount: orderPrice,
        // Reporting mirror of `amount`, the column admin-promoter's commission math
        // reads on the package table.
        paidAmount: orderPrice,
        // Promoter attribution denormalised off the order's frozen snapshot — the
        // same two JSON paths modules/promoter-data reads, resolved once here so the
        // reports do not need a JSON_EXTRACT. Both null for a referral code (its
        // earner is a customer, not a ws_promoter) and when no code was applied.
        promoterId: promoter.promoterId,
        promoterPercentage:
          promoter.promoterPercentage != null ? new Prisma.Decimal(promoter.promoterPercentage) : null,
        startAt, endAt, paymentType: "online", promocodeId: o.promocodeId ?? null,
        status: true, createdAt: now, updatedAt: now,
      },
    });
    return { sub, o };
  });
  await creditReferrer({ referrerId: order.referrerId, buyerId: order.customerId, orderId: order.id, paidAmount: orderPrice, source: "testSeries" });
  await debitWallet({ customerId: order.customerId, orderId: order.id, coin: order.wsCoin, source: "testSeries" });
  return toDto(result.sub, result.o);
};

// ── my-subscriptions test_series cards (active-only, dedup per series) ─────────
export const buildTestSeriesCards = async (customerId: number, now: Date) => {
  const all = await prisma.testSeriesSubscription.findMany({
    where: { customerId, status: true, endAt: { gt: now } },
    orderBy: { endAt: "desc" },
  });
  const seen = new Set<number>();
  const deduped = all.filter((s) => (s.testSeriesId && !seen.has(s.testSeriesId) ? (seen.add(s.testSeriesId), true) : false));
  const subs = deduped.sort((a, b) => (a.endAt?.getTime() ?? 0) - (b.endAt?.getTime() ?? 0));
  if (!subs.length) return [];
  const series = new Map((await prisma.testSeries.findMany({ where: { id: { in: [...new Set(subs.map((s) => s.testSeriesId))] } }, select: { id: true, title: true, thumbnail: true } })).map((t) => [t.id, t]));
  const MS = 86400000;
  return subs.map((s) => {
    const ts = s.testSeriesId ? series.get(s.testSeriesId) : null;
    return {
      _id: String(s.id), title: ts?.title || "Test Series", author: null, thumbnail: ts?.thumbnail || null, badge: "Test Series",
      daysLeft: s.endAt ? Math.max(0, Math.ceil((s.endAt.getTime() - now.getTime()) / MS)) : null,
      startAt: s.startAt ?? null, endAt: s.endAt ?? null,
      action: { kind: "test_series", courseId: null, packageId: null, planId: s.planId != null ? String(s.planId) : null, testSeriesId: String(s.testSeriesId), ebookId: null },
      meta: {},
    };
  });
};

// ── webhook fulfillment (razorpayOrderId-only; idempotent) ────────────────────
export const fulfillWebhookMysql = async (razorpayOrderId: string, razorpayPaymentId: string, now: Date = new Date()): Promise<TsVerifyDto | null> => {
  const order = await prisma.testSeriesOrder.findFirst({ where: { razorpayOrderId } });
  if (!order) return null;
  return verifyOrderMysql(order, razorpayPaymentId, now);
};
