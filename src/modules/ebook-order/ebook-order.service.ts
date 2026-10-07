// Ebook orders: checkout, payment verification and webhook fulfilment.
import { computeEndAt } from "../../utils/planDuration";
import type {
  PromocodeSnapshot,
  ReferralSnapshot,
} from "../order-code-snapshot/order-code-snapshot.types";
import { creditReferrer } from "../../client/referral/credit-referrer";
import { debitWallet } from "../../client/referral/debit-wallet";
import { ebookOrderRepository as repo } from "./ebook-order.repository";
import { toEbookOrderRow, toEbookOrderDto } from "./ebook-order.transformer";
import type {
  CreatedEbookOrder,
  EbookOrderDto,
  EbookOrderRow,
} from "./ebook-order.types";

export const parseEbookOrderId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Null when the plan is missing, has no ebook, is free, or is deactivated (so a disabled price row can't be bought). */
export const findEbookPlanForOrder = async (
  planId: number
): Promise<{ ebookId: number; price: number; duration: number } | null> => {
  const plan = await repo.findPlan(planId);
  if (!plan?.ebookId || plan.status === false || !plan.price || plan.price <= 0) return null;
  return { ebookId: plan.ebookId, price: plan.price, duration: plan.duration ?? 0 };
};

/** `uniqueId` is NOT NULL on the table; callers pass the receipt id. */
export const createEbookOrderMysql = async (input: {
  customerId: number;
  planId: number;
  orderPrice: number;
  razorpayOrderId: string;
  uniqueId: string;
  // Promo or referral snapshot, both stored in `promocode`; `referrerId` distinguishes them.
  code?: PromocodeSnapshot | ReferralSnapshot | null;
  // Credited at verify.
  referrerId?: number | null;
  // Debited at verify. 0/null = none.
  coin?: number | null;
}): Promise<CreatedEbookOrder> => {
  const order = await repo.createPendingOrder(input);
  return { orderId: order.id };
};

/** The order iff it owns this Razorpay id for this customer and its plan resolves to an ebook. */
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

/**
 * Idempotent: an already-complete order returns its DTO without re-running side
 * effects. `duration` is in DAYS. Returns the ORDER DTO, not the subscription.
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

  // The active sub only places the new window (renewal continues from its endAt);
  // it is never modified.
  const existingActive = await repo.findActiveEbookSub(customerId, ebookId, now);
  const startAt =
    existingActive?.endAt && existingActive.endAt.getTime() > now.getTime()
      ? existingActive.endAt
      : now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });
  const result = await repo.verifyEbookTx({
    orderId: order.id,
    razorpayPaymentId,
    customerId,
    ebookId,
    // This order's own price, not a running total across renewals.
    price,
    now,
    startAt,
    endAt,
    extended: !!existingActive,
  });
  if (!result) {
    // A concurrent /verify or webhook fulfilled this order first; never create a
    // second subscription.
    const orderRow = await repo.findOrderByRazorpay(order.razorpayOrderId ?? "", order.customerIdStr ?? "");
    if (!orderRow) throw new Error("ebook-order: order is not pending and cannot be re-read");
    return toEbookOrderDto(orderRow, ebookId);
  }
  await creditReferrer({ referrerId: order.referrerId, buyerId: customerId, orderId: order.id, paidAmount: price, source: "ebook" });
  await debitWallet({ customerId, orderId: order.id, coin: order.walletCoin, source: "ebook" });
  return toEbookOrderDto(result.order, ebookId);
};

/**
 * Keyed by razorpayOrderId alone (the payload carries no customer). Null when no
 * ebook order owns it. Safe to run before or after the client /verify call.
 */
export const fulfillEbookWebhookMysql = async (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<EbookOrderDto | null> => {
  const order = await repo.findOrderByRazorpayOnly(razorpayOrderId);
  if (!order || order.planId == null) return null;
  const plan = await repo.findPlan(order.planId);
  if (!plan?.ebookId) return null;
  return verifyEbookOrderMysql(toEbookOrderRow(order), razorpayPaymentId, now);
};
