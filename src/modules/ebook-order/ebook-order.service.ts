/**
 * Ebook · Order (WRITE — Phase 3b) service — dual-path (MySQL ↔ Mongo).
 *
 * Module key: `ebook-order`. Rides the commerce-order pattern. Gates the ebook
 * purchase flow across create-order/ebook + the verify ebook branch. See
 * ebook-order.types.ts for the scope/drift block.
 *
 * Exposes:
 *  - isEbookOrderMysql() / parseEbookOrderId()
 *  - findEbookPlanForOrder()       — read plan ebook/price/duration (create-order)
 *  - createEbookOrderMysql()       — write the pending order row
 *  - findEbookOrderForVerify()     — DUAL-READ owner lookup (rollback net)
 *  - verifyEbookOrderMysql()       — transactional fulfillment; idempotent
 *
 * Flag OFF until go-live sign-off.
 */
import { isMysqlModule } from "../../config/migration";
import { computeEndAt, extendEndAt } from "../../utils/planDuration";
import { ebookOrderRepository as repo } from "./ebook-order.repository";
import { toEbookOrderRow, toEbookOrderDto } from "./ebook-order.transformer";
import type {
  CreatedEbookOrder,
  EbookOrderDto,
  EbookOrderRow,
} from "./ebook-order.types";

export const EBOOK_ORDER_MODULE = "ebook-order";

export const isEbookOrderMysql = (): boolean => isMysqlModule(EBOOK_ORDER_MODULE);

export const parseEbookOrderId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Read an active ebook plan for create-order: {ebookId, price, duration} or null
 * if the plan doesn't exist / has no ebook / is free.
 */
export const findEbookPlanForOrder = async (
  planId: number
): Promise<{ ebookId: number; price: number; duration: number } | null> => {
  const plan = await repo.findPlan(planId);
  if (!plan?.ebookId || !plan.price || plan.price <= 0) return null;
  return { ebookId: plan.ebookId, price: plan.price, duration: plan.duration ?? 0 };
};

// ── create-order ────────────────────────────────────────────────────────────

/**
 * Write a pending ebook order to MySQL. `uniqueId` is required (NOT NULL on the
 * table) — we pass the receipt id. customerId is the int migrated id.
 */
export const createEbookOrderMysql = async (input: {
  customerId: number;
  planId: number;
  orderPrice: number;
  razorpayOrderId: string;
  uniqueId: string;
}): Promise<CreatedEbookOrder> => {
  const order = await repo.createPendingOrder(input);
  return { orderId: order.id };
};

// ── verify: dual-read owner lookup ──────────────────────────────────────────

/**
 * Owner lookup for verify. Returns the ebook order row iff a MySQL order owns
 * this Razorpay id for this customer AND its plan resolves to an ebook. Returns
 * null on miss — the caller falls back to the Mongo lookup (dual-read fallback).
 */
export const findEbookOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
): Promise<EbookOrderRow | null> => {
  const order = await repo.findOrderByRazorpay(razorpayOrderId, String(customerId));
  if (!order || order.planId == null) return null;
  const plan = await repo.findPlan(order.planId);
  if (!plan?.ebookId) return null;
  return toEbookOrderRow(order);
};

// ── verify: transactional fulfillment ───────────────────────────────────────

/**
 * Fulfill a verified ebook payment. Idempotent: an already-complete order
 * returns the existing order DTO without re-running side effects. Otherwise, in
 * ONE transaction: flip order → complete + extend-or-create the subscription.
 * `duration` is DAYS — endAt via planDuration `asDays:true`.
 *
 * Returns the Mongo-shaped EbookOrder DTO (the verify ebook branch returns the
 * ORDER, not the subscription).
 */
export const verifyEbookOrderMysql = async (
  order: EbookOrderRow,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<EbookOrderDto> => {
  if (order.planId == null) {
    throw new Error("ebook-order: order has no plan id");
  }
  const plan = await repo.findPlan(order.planId);
  const ebookId = plan?.ebookId ?? null;
  if (ebookId == null) {
    throw new Error("ebook-order: plan resolves to no ebook");
  }

  // Idempotency: already complete → return the existing order DTO.
  if (order.status !== "pending") {
    const orderRow = await repo.findOrderByRazorpay(
      order.razorpayOrderId ?? "",
      order.customerIdStr ?? ""
    );
    if (orderRow) return toEbookOrderDto(orderRow, ebookId);
  }

  const durationDays = plan?.duration ?? 0;
  const customerId = Number(order.customerIdStr);
  const price = order.orderPrice ?? 0;

  // Upsert-extend on an active subscription for this ebook.
  const existingActive = await repo.findActiveEbookSub(customerId, ebookId, now);

  if (existingActive) {
    const newEndAt = extendEndAt({
      currentEndAt: existingActive.endAt,
      durationMonths: durationDays,
      asDays: true,
      now,
    });
    const prevPrice = existingActive.price ? Number(existingActive.price.toString()) : 0;
    const result = await repo.verifyEbookTx({
      orderId: order.id,
      razorpayPaymentId,
      customerId,
      ebookId,
      price,
      now,
      extend: { existingSubId: existingActive.id, newEndAt, newPrice: prevPrice + price },
    });
    return toEbookOrderDto(result.order, ebookId);
  }

  const startAt = now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });
  const result = await repo.verifyEbookTx({
    orderId: order.id,
    razorpayPaymentId,
    customerId,
    ebookId,
    price,
    now,
    fresh: { startAt, endAt },
  });
  return toEbookOrderDto(result.order, ebookId);
};
