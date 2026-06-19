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

// ── ebook receipt (SQL mirror of getEbookReceipt) ────────────────────────────
// The only receipt endpoint with full column parity on SQL: book + course
// receipts read breakdown/paidAt/razorpay fields that ws_book_order /
// ws_package_course_subscription don't carry — those stay Mongo for now.
export const getEbookReceiptMysql = async (orderId: number, customerId: number) => {
  const order = await repo.ebookOrderForReceipt(orderId, customerId);
  if (!order) return null;

  // ws_ebook_order has no ebook_id → hop plan_id → price.ebook_id → ebook.
  const plan = order.planId ? await repo.planForReceipt(order.planId) : null;
  const ebook = plan?.ebookId ? await repo.ebookById(plan.ebookId) : null;

  return {
    kind: "ebook" as const,
    receiptId: String(order.id),
    purchasedAt: order.createdAt ?? null,
    paidAt: order.updatedAt ?? null,
    status: order.status,
    customer: { id: order.userId != null ? String(order.userId) : "" },
    payment: {
      method: order.paymentMethod,
      razorpayOrderId: order.gatewayOrderId ?? null,
      razorpayPaymentId: order.gatewayPaymentId ?? null,
    },
    items: [
      {
        name: ebook?.name ? `E-Book: ${ebook.name}` : "E-Book purchase",
        qty: 1,
        unitPrice: order.orderPrice,
        lineTotal: order.orderPrice,
      },
    ],
    totals: {
      subTotal: order.orderPrice,
      grandTotal: order.orderPrice,
      currency: "INR" as const,
    },
    extra: {
      ebookId: ebook ? String(ebook.id) : null,
      planId: order.planId != null ? String(order.planId) : null,
      duration: plan?.duration ?? null,
      transactionId: order.bankTransactionId ?? null,
    },
  };
};

// ── book receipt (SQL mirror of getBookReceipt) ──────────────────────────────
// DRIFT: ws_book_order carries only `amount` (order_price) — there is NO
// total_discounted_price / total_shipping_price / total_list_price column, so
// the discount/shipping split is not stored on SQL and collapses to amount.
export const getBookReceiptMysql = async (orderId: number, customerId: number) => {
  const o = await repo.bookOrderForReceipt(orderId, customerId);
  if (!o) return null;

  const rawItems = parseOrderItems(o.orderItems);
  // backfill missing names via a Book lookup (item field = bookId).
  const missingIds = [...new Set(rawItems.filter((it) => !it.name).map((it) => Number(it.item)).filter((x) => Number.isInteger(x) && x > 0))];
  const nameById = new Map((await repo.booksByIds(missingIds)).map((b) => [b.id, b.name]));
  const items = rawItems.map((it) => {
    const name = it.name ?? nameById.get(Number(it.item)) ?? null;
    return { name, qty: it.qty, unitPrice: it.price, lineTotal: it.price * it.qty };
  });

  const amount = Number(o.amount);
  return {
    kind: "book" as const,
    receiptId: o.receiptId,
    purchasedAt: o.createdAt,
    paidAt: o.paidAt ?? null,
    status: o.status,
    customer: { id: String(o.userId) },
    payment: {
      method: o.paymentMethod,
      razorpayOrderId: o.gatewayOrderId ?? null,
      razorpayPaymentId: o.gatewayPaymentId ?? null,
    },
    items,
    totals: {
      // DRIFT: discount/shipping breakdown is not stored on ws_book_order.
      subTotal: amount,
      shipping: 0,
      discount: 0,
      grandTotal: amount,
      currency: "INR" as const,
    },
    extra: {
      shippingId: o.shippingId ?? null,
      tracking: {
        trackingId: o.BookTracking?.tracking_id != null ? String(o.BookTracking.tracking_id) : null,
        status: o.BookTracking?.status ?? null,
      },
    },
  };
};

// ── course/package receipt (SQL mirror of getCourseReceipt) ──────────────────
// DRIFT: ws_package_course_subscription has NO paid_at and NO razorpay columns.
// Mongo's paymentStatus:"verified" → status=true here; razorpay ids are read
// via the order hop; paidAt stays null (no column anywhere).
export const getCourseReceiptMysql = async (subId: number, customerId: number) => {
  const sub = await repo.subscriptionForReceipt(subId, customerId);
  if (!sub) return null;

  const [plan, course, pkg, order] = await Promise.all([
    sub.planId ? repo.planDurationForReceipt(sub.planId) : Promise.resolve(null),
    sub.courseId ? repo.courseForReceipt(sub.courseId) : Promise.resolve(null),
    sub.packageId ? repo.packageForReceipt(sub.packageId) : Promise.resolve(null),
    sub.orderId ? repo.courseOrderForReceipt(sub.orderId) : Promise.resolve(null),
  ]);

  const isPackageKind = !sub.courseId && !!pkg;
  const lineName =
    course?.name && pkg?.name
      ? `${course.name} — ${pkg.name}`
      : course?.name || pkg?.name || "Subscription";
  const amount = Number(sub.amount ?? 0);

  return {
    kind: isPackageKind ? ("package" as const) : ("course" as const),
    receiptId: String(sub.id),
    purchasedAt: sub.createdAt ?? null,
    paidAt: null,
    status: "verified",
    customer: { id: String(sub.customerId) },
    payment: {
      method: "razorpay",
      razorpayOrderId: order?.gatewayOrderId ?? null,
      razorpayPaymentId: order?.gatewayPaymentId ?? null,
    },
    items: [
      {
        name: lineName,
        qty: 1,
        unitPrice: amount,
        lineTotal: amount,
      },
    ],
    totals: {
      subTotal: amount,
      grandTotal: amount,
      currency: "INR" as const,
    },
    extra: {
      courseId: sub.courseId != null ? String(sub.courseId) : null,
      targetPackageId: sub.packageId != null ? String(sub.packageId) : null,
      planId: sub.planId != null ? String(sub.planId) : null,
      duration: plan?.duration ?? null,
      startAt: sub.startAt ?? null,
      endAt: sub.endAt ?? null,
    },
  };
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
