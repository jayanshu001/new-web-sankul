import { prisma } from "../../config/prisma";
import { computeEndAt, extendEndAt } from "../../utils/planDuration";

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
  promocodeId: number | null; razorpayOrderId: string;
}): Promise<{ orderId: number }> => {
  const o = await prisma.testSeriesOrder.create({ data: {
    customerId: input.customerId, testSeriesId: input.testSeriesId, planId: input.planId,
    paymentMethod: "razorpay", orderType: "purchase",
    orderPrice: input.bd.totalAmount, basePrice: input.bd.basePrice, discountAmount: input.bd.discountAmount,
    gstAmount: input.bd.gstAmount, handlingFee: input.bd.handlingFee, promocodeId: input.promocodeId,
    razorpayOrderId: input.razorpayOrderId, status: "pending",
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

const toDto = (sub: any, order: any): TsVerifyDto => ({
  _id: String(sub.id), customerId: sub.customerId, testSeriesId: sub.testSeriesId, planId: sub.planId ?? null,
  startAt: sub.startAt ?? null, endAt: sub.endAt ?? null, status: sub.status, price: num(sub.price),
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
  const orderPrice = num(order.orderPrice);

  const existingActive = await prisma.testSeriesSubscription.findFirst({
    where: { customerId: order.customerId, testSeriesId: order.testSeriesId, status: true, endAt: { gt: now } },
    orderBy: { endAt: "desc" },
  });

  const result = await prisma.$transaction(async (tx) => {
    const o = await tx.testSeriesOrder.update({ where: { id: order.id }, data: { status: "complete", razorpayPaymentId } });
    if (existingActive) {
      const newEndAt = extendEndAt({ currentEndAt: existingActive.endAt, durationMonths: durationDays, asDays: true, now });
      const sub = await tx.testSeriesSubscription.update({
        where: { id: existingActive.id },
        data: { endAt: newEndAt, price: num(existingActive.price) + orderPrice, orderId: o.id, ...(o.promocodeId ? { promocodeId: o.promocodeId } : {}) },
      });
      return { sub, o };
    }
    const startAt = now;
    const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });
    const sub = await tx.testSeriesSubscription.create({
      // created_at has no DB default (introspected legacy table) — set it or the row is
      // invisible to created_at-windowed reads (admin dashboard, purchase history).
      data: { orderId: o.id, customerId: o.customerId, testSeriesId: o.testSeriesId, planId: o.planId, price: orderPrice, startAt, endAt, paymentType: "online", promocodeId: o.promocodeId ?? null, status: true, createdAt: now, updatedAt: now },
    });
    return { sub, o };
  });
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
