// Test-series orders: checkout, payment verification, webhook and dashboard cards.
import { Prisma } from "@prisma/client";
import { computeDaysLeft } from "../../utils/planDuration";
import type { TestSeriesOrder, TestSeriesSubscription } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { extractPromoterAttribution } from "../order-code-snapshot/order-code-snapshot.service";
import { computeEndAt } from "../../utils/planDuration";
import { creditReferrer } from "../referral/credit-referrer";
import { debitWallet } from "../referral/debit-wallet";

const num = (v: any): number => (v == null ? 0 : Number(v.toString?.() ?? v) || 0);

// Active paid plan only; null for a missing or free plan.
export const findPlanForOrder = async (planId: number) => {
  const plan = await prisma.testSeriesPrice.findFirst({ where: { id: planId, status: true } });
  if (!plan) return null;
  const price = num(plan.price);
  if (price <= 0) return null;
  return { id: plan.id, testSeriesId: plan.testSeriesId, durationDays: plan.durationDays, price, originalPrice: plan.originalPrice != null ? num(plan.originalPrice) : null };
};

export const findSeries = (id: number) =>
  prisma.testSeries.findFirst({ where: { id, status: true }, select: { id: true, title: true } });

export const listPlansForSeries = (testSeriesId: number) =>
  prisma.testSeriesPrice.findMany({ where: { testSeriesId, status: true }, orderBy: { durationDays: "asc" } });

export const createOrderMysql = async (input: {
  customerId: number; testSeriesId: number; planId: number;
  bd: { basePrice: number; discountAmount: number; gstAmount: number; handlingFee: number; totalAmount: number };
  promocodeId: number | null; razorpayOrderId: string; referrerId?: number | null; coin?: number | null;
  /** Stored on unique_id / razorpay_order / ip_address and the two json snapshot columns, as in createPackageOrderMysql. */
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
    // amount = charged total, originalPrice = plan list price.
    amount: Math.round(input.bd.totalAmount),
    originalPrice: input.bd.basePrice,
    codeDiscount: Math.round(input.bd.discountAmount),
    wsCoin: input.coin ?? 0,
    promocodeId: input.promocodeId,
    // `?? Prisma.DbNull`, not `?? null`: a bare null on a Json column is stored as JSON
    // `null`, which promoter-data's JSON_EXTRACT paths treat as a non-empty value. SQL
    // NULL means "no code".
    promocode: (input.promocodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
    refferalcode: (input.refferalcodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
    referrerId: input.referrerId ?? null,
    razorpayOrderId: input.razorpayOrderId,
    razorpayOrder: input.razorpayOrderPayload ?? null,
    ipAddress: input.ipAddress ?? null,
    status: "pending",
    // created_at/updated_at have no DB default (introspected table); without them the
    // admin Orders tab renders "—" and `orderBy createdAt desc` is unpredictable.
    createdAt: now, updatedAt: now,
  }});
  return { orderId: o.id };
};

export const findOrderForVerify = (razorpayOrderId: string, customerId: number) =>
  prisma.testSeriesOrder.findFirst({ where: { razorpayOrderId, customerId } });

export type TsVerifyDto = {
  _id: string; customerId: number; testSeriesId: number; planId: number | null;
  startAt: Date | null; endAt: Date | null; status: boolean; price: number;
  orderId: number; razorpayOrderId: string | null; razorpayPaymentId: string | null;
};

// Typed, not `any`, so a column rename fails tsc instead of silently emitting 0.
// The wire key stays `price`.
const toDto = (sub: TestSeriesSubscription, order: TestSeriesOrder): TsVerifyDto => ({
  _id: String(sub.id), customerId: sub.customerId, testSeriesId: sub.testSeriesId, planId: sub.planId ?? null,
  startAt: sub.startAt ?? null, endAt: sub.endAt ?? null, status: sub.status, price: num(sub.amount),
  orderId: order.id, razorpayOrderId: order.razorpayOrderId ?? null, razorpayPaymentId: order.razorpayPaymentId ?? null,
});

// Fulfil a paid order (idempotent; one order creates exactly one subscription).
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
    // Claim the order: only a still-pending row flips. The loser of a concurrent
    // /verify + webhook matches 0 rows, writes nothing and returns null.
    const claim = await tx.testSeriesOrder.updateMany({ where: { id: order.id, status: "pending" }, data: { status: "complete", razorpayPaymentId, updatedAt: now } });
    if (claim.count === 0) return null;
    const o = await tx.testSeriesOrder.findUniqueOrThrow({ where: { id: order.id } });
    const sub = await tx.testSeriesSubscription.create({
      // created_at has no DB default; without it the row is invisible to created_at-windowed
      // reads. `amount` is this order's charge, never a running total.
      data: {
        orderId: o.id, customerId: o.customerId, testSeriesId: o.testSeriesId, planId: o.planId,
        amount: orderPrice,
        // Mirror of `amount`; admin-promoter's commission math reads it.
        paidAmount: orderPrice,
        // Denormalised off the order's snapshot (same JSON paths as promoter-data) so
        // reports need no JSON_EXTRACT. Null for referral codes and when no code applied.
        promoterId: promoter.promoterId,
        promoterPercentage:
          promoter.promoterPercentage != null ? new Prisma.Decimal(promoter.promoterPercentage) : null,
        startAt, endAt, paymentType: "online", promocodeId: o.promocodeId ?? null,
        status: true, createdAt: now, updatedAt: now,
      },
    });
    return { sub, o };
  });
  if (!result) {
    // Lost the claim: a concurrent /verify or webhook fulfilled this order first.
    // Return the subscription it created; never create a second one.
    const existing = await prisma.testSeriesSubscription.findFirst({ where: { orderId: order.id } });
    const fulfilled = await prisma.testSeriesOrder.findFirst({ where: { id: order.id } });
    if (!existing || !fulfilled) throw new Error("test-series-order: order is not pending and has no subscription");
    return toDto(existing, fulfilled);
  }
  await creditReferrer({ referrerId: order.referrerId, buyerId: order.customerId, orderId: order.id, paidAmount: orderPrice, source: "testSeries" });
  await debitWallet({ customerId: order.customerId, orderId: order.id, coin: order.wsCoin, source: "testSeries" });
  return toDto(result.sub, result.o);
};

// Dashboard cards: one per series (latest active sub), soonest expiry first.
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
  return subs.map((s) => {
    const ts = s.testSeriesId ? series.get(s.testSeriesId) : null;
    return {
      _id: String(s.id), title: ts?.title || "Test Series", author: null, thumbnail: ts?.thumbnail || null, badge: "Test Series",
      daysLeft: computeDaysLeft(s.endAt, now),
      startAt: s.startAt ?? null, endAt: s.endAt ?? null,
      action: { kind: "test_series", courseId: null, packageId: null, planId: s.planId != null ? String(s.planId) : null, testSeriesId: String(s.testSeriesId), ebookId: null },
      meta: {},
    };
  });
};

export const fulfillWebhookMysql = async (razorpayOrderId: string, razorpayPaymentId: string, now: Date = new Date()): Promise<TsVerifyDto | null> => {
  const order = await prisma.testSeriesOrder.findFirst({ where: { razorpayOrderId } });
  if (!order) return null;
  return verifyOrderMysql(order, razorpayPaymentId, now);
};
