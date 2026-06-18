import { isMysqlModule } from "../../config/migration";
import { clientPurchaseHistoryRepository as repo } from "./client-purchase-history.repository";

export const PURCHASE_HISTORY_MODULE = "client-purchase-history";
export const isPurchaseHistoryMysql = (): boolean => isMysqlModule(PURCHASE_HISTORY_MODULE);

export const parsePhId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const RECEIPT_BASE = "/api/v1/client/purchase-history";

// ── subscriptions tab ──────────────────────────────────────────────────────────
export const listSubscriptions = async (customerId: number, skip: number, take: number, page: number, limit: number) => {
  const [subs, total] = await Promise.all([
    repo.listSubscriptions(customerId, skip, take),
    repo.countSubscriptions(customerId),
  ]);
  if (!subs.length) return { data: [], pagination: { total, page, limit, totalPages: 0 } };

  const courses = new Map((await repo.coursesByIds([...new Set(subs.map((s) => s.courseId).filter((x): x is number => x != null && x > 0))])).map((c) => [c.id, c]));
  const packages = new Map((await repo.packagesByIds([...new Set(subs.map((s) => s.packageId).filter((x): x is number => x != null && x > 0))])).map((p) => [p.id, p]));
  const types = new Map((await repo.packageTypesByIds([...new Set([...packages.values()].map((p) => p.packageTypeId).filter((x): x is number => x != null && x > 0))])).map((t) => [t.id, t]));

  const data = subs.map((s) => {
    const course = s.courseId ? courses.get(s.courseId) : null;
    const pkg = s.packageId ? packages.get(s.packageId) : null;
    const type = pkg?.packageTypeId ? types.get(pkg.packageTypeId) : null;
    return {
      _id: String(s.id),
      kind: s.courseId ? "course" : "package",
      title: course?.name || pkg?.name || "Subscription",
      author: null, // ws_course has no author column (Mongo-only)
      thumbnail: course?.image || pkg?.image || null,
      badge: type?.name || null,
      amount: s.amount != null ? Number(s.amount) : null,
      purchasedAt: s.createdAt ?? null,
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      receiptUrl: `${RECEIPT_BASE}/subscriptions/${s.id}/receipt`,
      meta: {
        courseId: s.courseId != null && s.courseId > 0 ? String(s.courseId) : null,
        targetPackageId: s.packageId != null && s.packageId > 0 ? String(s.packageId) : null,
        planId: s.planId != null && s.planId > 0 ? String(s.planId) : null,
        // razorpay ids not stored on ws_package_course_subscription (Mongo-only)
        razorpayOrderId: null,
        razorpayPaymentId: null,
      },
    };
  });
  return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

// ── books tab ────────────────────────────────────────────────────────────────
const parseOrderItems = (json: string | null): any[] => {
  if (!json) return [];
  try { const a = JSON.parse(json); return Array.isArray(a) ? a : []; } catch { return []; }
};

export const listBooks = async (customerId: number, statuses: string[], skip: number, take: number, page: number, limit: number) => {
  const [orders, total] = await Promise.all([
    repo.listBookOrders(customerId, statuses, skip, take),
    repo.countBookOrders(customerId, statuses),
  ]);
  // first-item thumbnails from the order_items JSON (the `item` field is bookId).
  const itemsByOrder = new Map<number, any[]>();
  orders.forEach((o) => itemsByOrder.set(o.id, parseOrderItems(o.orderItems)));
  const firstBookIds = [...new Set([...itemsByOrder.values()].map((items) => items[0]?.item).filter((x) => x != null).map(Number))];
  const thumbById = new Map((await repo.booksByIds(firstBookIds)).map((b) => [b.id, b.thumbnail || b.image || null]));

  const data = orders.map((o) => {
    const items = itemsByOrder.get(o.id) ?? [];
    const first = items[0];
    const more = items.length - 1;
    const title = first ? (more > 0 ? `${first.name} +${more} more` : first.name) : "Books order";
    return {
      _id: String(o.id),
      title,
      thumbnail: first?.item != null ? thumbById.get(Number(first.item)) ?? null : null,
      amount: Number(o.amount),
      purchasedAt: o.createdAt ?? null,
      status: o.status,
      receiptUrl: `${RECEIPT_BASE}/books/${o.id}/receipt`,
      tracking: {
        // ws_book_tracking is a flat status row → AWB only; no courier column.
        trackingId: o.BookTracking?.tracking_id != null ? String(o.BookTracking.tracking_id) : null,
        courier: null,
      },
      meta: {
        receiptId: o.receiptId,
        itemsCount: items.length,
        razorpayOrderId: o.gatewayOrderId ?? null,
        razorpayPaymentId: o.gatewayPaymentId ?? null,
      },
    };
  });
  return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

// ── ebooks tab ─────────────────────────────────────────────────────────────────
export const listEbooks = async (customerId: number, status: string, skip: number, take: number, page: number, limit: number) => {
  const [orders, total] = await Promise.all([
    repo.listEbookOrders(customerId, status, skip, take),
    repo.countEbookOrders(customerId, status),
  ]);
  // ws_ebook_order has no ebook_id → hop order.plan_id → price.ebook_id → ebook.
  const planIds = [...new Set(orders.map((o) => o.planId).filter((x): x is number => x != null && x > 0))];
  const plans = new Map((await repo.plansByIds(planIds)).map((p) => [p.id, p]));
  const ebookIds = [...new Set([...plans.values()].map((p) => p.ebookId).filter((x): x is number => x != null && x > 0))];
  const ebooks = new Map((await repo.ebooksByIds(ebookIds)).map((e) => [e.id, e]));

  const data = orders.map((o) => {
    const plan = o.planId ? plans.get(o.planId) : null;
    const ebook = plan?.ebookId ? ebooks.get(plan.ebookId) : null;
    return {
      _id: String(o.id),
      title: ebook?.name ? `E-Book: ${ebook.name}` : "E-Book purchase",
      author: ebook?.author || null,
      thumbnail: ebook?.thumbnail || null,
      amount: o.orderPrice,
      purchasedAt: o.createdAt ?? null,
      status: o.status,
      receiptUrl: `${RECEIPT_BASE}/ebooks/${o.id}/receipt`,
      meta: {
        ebookId: ebook ? String(ebook.id) : null,
        razorpayOrderId: o.gatewayOrderId ?? null,
        razorpayPaymentId: o.gatewayPaymentId ?? null,
        transactionId: o.bankTransactionId ?? null,
      },
    };
  });
  return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};
