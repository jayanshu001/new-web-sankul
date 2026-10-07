// Purchase history: merged purchase list, shipment tracking and receipts.
import { clientPurchaseHistoryRepository as repo } from "./client-purchase-history.repository";
import { formatPaymentMethod, formatPaymentType } from "../../utils/paymentMethod";
import { COURIER } from "../../config/courier";
import { liveSubDiscountAmount } from "../live-course-order/live-course-order.service";

export const parsePhId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const RECEIPT_BASE = "/api/v1/client/purchase-history";

/**
 * Live-course ORDER status → the subscription vocabulary this API has always emitted
 * ('cancel' goes out as "failed"). Defaults to "verified": every caller is gated to a
 * completed order.
 */
const livePayStatus = (order: { status: string } | null | undefined): string =>
  order == null || order.status === "complete" ? "verified"
  : order.status === "cancel" ? "failed"
  : order.status;

// Same threshold buildTrackingUrl routes on: at/above Tirupati INITIAL_Number → "tirupati",
// below → "mahavir"; null when no AWB is allocated.
const courierForAwb = (awb: number | bigint | null | undefined): string | null => {
  if (awb == null) return null;
  return Number(awb) >= COURIER.TIRUPATI.INITIAL_Number ? "tirupati" : "mahavir";
};

// The subscriptions tab unions course/package, live-course and test-series purchases. Each
// table has its own PK space, so live rows carry an "lc_" and test-series rows a "ts_" id
// prefix for /subscriptions/:id/receipt. Every source is over-fetched to (skip+take), merged
// by purchasedAt desc, then sliced so pagination stays correct.
const LIVE_ID_PREFIX = "lc_";
const TS_ID_PREFIX = "ts_";
// Order-less legacy subscriptions get a distinct prefix so receipt/tracking route to the sub path.
const PCS_ID_PREFIX = "pcs_";
const TSS_ID_PREFIX = "tss_";

/**
 * The row matching the order's own plan target, newest `end_at` first (`courseId` wins: a plan
 * carrying both is a course plan). Undefined hands over to the per-target legacy fallback.
 */
type PcWindow = { orderId: number | null; courseId: number | null; packageId: number | null; startAt: Date | null; endAt: Date | null };
const pickWindowForTarget = (rows: readonly PcWindow[] | undefined, courseId: number | null, packageId: number | null): PcWindow | undefined => {
  if (!rows?.length) return undefined;
  // A single row is the one subscription this order created; trust it even if the plan was
  // edited since. Target-matching only disambiguates legacy buckets with several rows.
  if (rows.length === 1) return rows[0];
  const matches = rows.filter((s) => (courseId ? s.courseId === courseId : packageId ? s.packageId === packageId : true));
  if (!matches.length) return undefined;
  return matches.reduce((best, s) => ((s.endAt?.getTime() ?? 0) > (best.endAt?.getTime() ?? 0) ? s : best));
};

// Merged, paged history of course/package, live-course and test-series purchases.
export const listSubscriptions = async (customerId: number, skip: number, take: number, page: number, limit: number) => {
  const overFetch = skip + take;
  // Package/course + test-series list from their ORDER tables (one row per purchase);
  // legacy subs with no order are unioned back in so history isn't lost.
  const [pcOrders, pcTotal, liveSubs, liveTotal, tsOrders, tsTotal, olSubs, olTotal, olTsSubs, olTsTotal] = await Promise.all([
    repo.listPurchaseOrders(customerId, 0, overFetch),
    repo.countPurchaseOrders(customerId),
    repo.listLiveSubscriptions(customerId, overFetch),
    repo.countLiveSubscriptions(customerId),
    repo.listTestSeriesOrders(customerId, 0, overFetch),
    repo.countTestSeriesOrders(customerId),
    repo.listOrderlessSubs(customerId, 0, overFetch),
    repo.countOrderlessSubs(customerId),
    repo.listOrderlessTsSubs(customerId, overFetch),
    repo.countOrderlessTsSubs(customerId),
  ]);
  const grandTotal = pcTotal + liveTotal + tsTotal + olTotal + olTsTotal;
  if (!pcOrders.length && !liveSubs.length && !tsOrders.length && !olSubs.length && !olTsSubs.length) return { data: [], pagination: { total: grandTotal, page, limit, totalPages: 0 } };

  // Lookups are grouped into three rounds by real dependency depth:
  //   round 1  plans, liveCourses, testSeries, tracking, ownSubs — need only the listed rows
  //   round 2  courses, packages, tsSubs                         — need plans / testSeries
  //   round 3  types (+ the legacy window fallback, usually skipped) — need packages / plans
  // Keep new lookups in the shallowest round they belong to; a later round costs a round trip.
  const tsIds = new Set<number>([...tsOrders.map((o) => o.testSeriesId), ...olTsSubs.map((s) => s.testSeriesId)].filter((x): x is number => x != null && x > 0));

  const pcOrderIds = pcOrders.map((o) => o.id);

  const [plans, liveCourses, testSeries, trackingByOrder, ownSubs] = await Promise.all([
    repo.pcPlansByIds([...new Set(pcOrders.map((o) => o.planId).filter((x): x is number => x != null && x > 0))]).then((r) => new Map(r.map((p) => [p.id, p]))),
    repo.liveCoursesByIds([...new Set(liveSubs.map((s) => s.liveCourseId).filter((x): x is number => x != null && x > 0))]).then((r) => new Map(r.map((c) => [c.id, c]))),
    repo.testSeriesByIds([...tsIds]).then((r) => new Map(r.map((t) => [t.id, t]))),
    repo.pcTrackingByOrderIds(pcOrderIds).then((r) => new Map(r.map((t) => [t.orderId, t]))),
    repo.pcSubsByOrderIds(customerId, pcOrderIds),
  ]);
  // Grouped, not keyed 1:1: legacy data can hold several active rows per order_id, and
  // pickWindowForTarget makes the choice deterministic.
  const subsByOrder = new Map<number, PcWindow[]>();
  for (const s of ownSubs) {
    const k = s.orderId as number;
    const bucket = subsByOrder.get(k);
    if (bucket) bucket.push(s);
    else subsByOrder.set(k, [s]);
  }

  const courseIds = new Set<number>([...[...plans.values()].map((p) => p.courseId), ...olSubs.map((s) => s.courseId)].filter((x): x is number => x != null && x > 0));
  const packageIds = new Set<number>([...[...plans.values()].map((p) => p.packageId), ...olSubs.map((s) => s.packageId)].filter((x): x is number => x != null && x > 0));

  const [courses, packages, tsSubs] = await Promise.all([
    repo.coursesByIds([...courseIds]).then((r) => new Map(r.map((c) => [c.id, c]))),
    repo.packagesByIds([...packageIds]).then((r) => new Map(r.map((p) => [p.id, p]))),
    repo.tsSubsForSeries(customerId, [...testSeries.keys()]),
  ]);

  // Legacy window fallback, only for orders that own no subscription row (see repository).
  const fbCourseIds = new Set<number>();
  const fbPackageIds = new Set<number>();
  for (const o of pcOrders) {
    if (subsByOrder.has(o.id)) continue;
    const plan = o.planId ? plans.get(o.planId) : null;
    if (plan?.courseId && plan.courseId > 0) fbCourseIds.add(plan.courseId);
    else if (plan?.packageId && plan.packageId > 0) fbPackageIds.add(plan.packageId);
  }

  const [types, fbCourseSubs, fbPackageSubs] = await Promise.all([
    repo.packageTypesByIds([...new Set([...packages.values()].map((p) => p.packageTypeId).filter((x): x is number => x != null && x > 0))]).then((r) => new Map(r.map((t) => [t.id, t]))),
    repo.pcSubsByCourseIds(customerId, [...fbCourseIds]),
    repo.pcSubsByPackageIds(customerId, [...fbPackageIds]),
  ]);
  // A sub carrying both ids keys on the course.
  const latestSubByKey = new Map<string, (typeof fbCourseSubs)[number]>();
  for (const s of [...fbCourseSubs, ...fbPackageSubs]) {
    const key = s.courseId ? `c:${s.courseId}` : s.packageId ? `p:${s.packageId}` : null;
    if (!key) continue;
    const cur = latestSubByKey.get(key);
    if (!cur || (s.endAt?.getTime() ?? 0) > (cur.endAt?.getTime() ?? 0)) latestSubByKey.set(key, s);
  }

  const pkgRows = pcOrders.map((o) => {
    const plan = o.planId ? plans.get(o.planId) : null;
    const courseId = plan?.courseId && plan.courseId > 0 ? plan.courseId : null;
    const packageId = plan?.packageId && plan.packageId > 0 ? plan.packageId : null;
    const course = courseId ? courses.get(courseId) : null;
    const pkg = packageId ? packages.get(packageId) : null;
    const type = pkg?.packageTypeId ? types.get(pkg.packageTypeId) : null;
    // The AWB/status live on the tracking row created at verify; it may be null.
    const withMaterial = !!plan?.withMaterial;
    const track = trackingByOrder.get(o.id) ?? null;
    const tracking =
      withMaterial && track
        ? { trackingId: String(track.id), courier: courierForAwb(track.id) }
        : null;
    const win =
      pickWindowForTarget(subsByOrder.get(o.id), courseId, packageId) ??
      (courseId ? latestSubByKey.get(`c:${courseId}`) : packageId ? latestSubByKey.get(`p:${packageId}`) : null) ??
      null;
    return {
      _id: String(o.id),
      kind: courseId ? "course" : "package",
      title: course?.name || pkg?.name || "Subscription",
      author: null, // ws_course has no author column
      thumbnail: course?.image || pkg?.image || null,
      badge: type?.name || null,
      withMaterial,
      status: withMaterial ? (track?.status ?? null) : null,
      tracking,
      amount: o.amount != null ? Number(o.amount) : null,
      purchasedAt: o.createdAt ?? null,
      startAt: win?.startAt ?? null,
      endAt: win?.endAt ?? null,
      receiptUrl: `${RECEIPT_BASE}/subscriptions/${o.id}/receipt`,
      meta: {
        courseId: courseId ? String(courseId) : null,
        targetPackageId: packageId ? String(packageId) : null,
        planId: o.planId != null && o.planId > 0 ? String(o.planId) : null,
        razorpayOrderId: o.gatewayOrderId ?? null,
        razorpayPaymentId: o.gatewayPaymentId ?? null,
      },
    };
  });

  const liveRows = liveSubs.map((s) => {
    const lc = s.liveCourseId ? liveCourses.get(s.liveCourseId) : null;
    const withMaterial = !!s.withMaterial;
    // `s.tracking` is the AWB column; the DTO key stays `trackingId`.
    const tracking =
      withMaterial && s.tracking != null
        ? { trackingId: String(s.tracking), courier: courierForAwb(s.tracking) }
        : null;
    return {
      _id: `${LIVE_ID_PREFIX}${s.id}`,
      kind: "live-course",
      title: lc?.name || "Live Course",
      author: null,
      thumbnail: lc?.image || null,
      badge: "Live",
      withMaterial,
      status: withMaterial ? ((s as any).trackingRow?.status ?? null) : null,
      tracking,
      // `amount` = ws_live_course_order.discount_price.
      amount: s.order?.amount != null ? Number(s.order.amount) : null,
      purchasedAt: s.createdAt ?? s.startAt ?? null,
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      receiptUrl: `${RECEIPT_BASE}/subscriptions/${LIVE_ID_PREFIX}${s.id}/receipt`,
      meta: {
        liveCourseId: s.liveCourseId != null && s.liveCourseId > 0 ? String(s.liveCourseId) : null,
        planId: s.planId != null && s.planId > 0 ? String(s.planId) : null,
        razorpayOrderId: s.order?.razorpayOrderId ?? null,
        razorpayPaymentId: s.order?.razorpayPaymentId ?? null,
      },
    };
  });

  const tsSubByOrder = new Map(tsSubs.filter((s) => s.orderId != null).map((s) => [s.orderId as number, s]));
  const latestTsSubByTs = new Map<number, (typeof tsSubs)[number]>();
  for (const s of tsSubs) {
    const cur = latestTsSubByTs.get(s.testSeriesId);
    if (!cur || (s.endAt?.getTime() ?? 0) > (cur.endAt?.getTime() ?? 0)) latestTsSubByTs.set(s.testSeriesId, s);
  }

  const tsRows = tsOrders.map((o) => {
    const ts = o.testSeriesId ? testSeries.get(o.testSeriesId) : null;
    const win = tsSubByOrder.get(o.id) ?? latestTsSubByTs.get(o.testSeriesId) ?? null;
    return {
      _id: `${TS_ID_PREFIX}${o.id}`,
      kind: "test-series",
      title: ts?.title || "Test Series",
      author: null,
      thumbnail: ts?.thumbnail || null,
      badge: "Test Series",
      // Test series never ships physical material.
      withMaterial: false,
      status: null,
      tracking: null,
      amount: o.amount != null ? Number(o.amount) : null,
      purchasedAt: o.createdAt ?? null,
      startAt: win?.startAt ?? null,
      endAt: win?.endAt ?? null,
      receiptUrl: `${RECEIPT_BASE}/subscriptions/${TS_ID_PREFIX}${o.id}/receipt`,
      meta: {
        testSeriesId: o.testSeriesId != null && o.testSeriesId > 0 ? String(o.testSeriesId) : null,
        planId: o.planId != null && o.planId > 0 ? String(o.planId) : null,
        razorpayOrderId: o.razorpayOrderId ?? null,
        razorpayPaymentId: o.razorpayPaymentId ?? null,
      },
    };
  });

  const orderlessPkgRows = olSubs.map((s) => {
    const course = s.courseId ? courses.get(s.courseId) : null;
    const pkg = s.packageId ? packages.get(s.packageId) : null;
    const type = pkg?.packageTypeId ? types.get(pkg.packageTypeId) : null;
    const withMaterial = s.materialAmount != null;
    const trackStatus = (s as any).packageCourseSubscriptionTracking?.status ?? null;
    const tracking =
      withMaterial && s.trackingId != null
        ? { trackingId: String(s.trackingId), courier: courierForAwb(s.trackingId) }
        : null;
    return {
      _id: `${PCS_ID_PREFIX}${s.id}`,
      kind: s.courseId ? "course" : "package",
      title: course?.name || pkg?.name || "Subscription",
      author: null,
      thumbnail: course?.image || pkg?.image || null,
      badge: type?.name || null,
      withMaterial,
      status: withMaterial ? trackStatus : null,
      tracking,
      amount: s.amount != null ? Number(s.amount) : null,
      purchasedAt: s.createdAt ?? s.startAt ?? null,
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      receiptUrl: `${RECEIPT_BASE}/subscriptions/${PCS_ID_PREFIX}${s.id}/receipt`,
      meta: {
        courseId: s.courseId != null && s.courseId > 0 ? String(s.courseId) : null,
        targetPackageId: s.packageId != null && s.packageId > 0 ? String(s.packageId) : null,
        planId: s.planId != null && s.planId > 0 ? String(s.planId) : null,
        razorpayOrderId: null,
        razorpayPaymentId: null,
      },
    };
  });

  const orderlessTsRows = olTsSubs.map((s) => {
    const ts = s.testSeriesId ? testSeries.get(s.testSeriesId) : null;
    return {
      _id: `${TSS_ID_PREFIX}${s.id}`,
      kind: "test-series",
      title: ts?.title || "Test Series",
      author: null,
      thumbnail: ts?.thumbnail || null,
      badge: "Test Series",
      withMaterial: false,
      status: null,
      tracking: null,
      amount: s.amount != null ? Number(s.amount) : null,
      purchasedAt: s.createdAt ?? s.startAt ?? null,
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      receiptUrl: `${RECEIPT_BASE}/subscriptions/${TSS_ID_PREFIX}${s.id}/receipt`,
      meta: {
        testSeriesId: s.testSeriesId != null && s.testSeriesId > 0 ? String(s.testSeriesId) : null,
        planId: s.planId != null && s.planId > 0 ? String(s.planId) : null,
        razorpayOrderId: null,
        razorpayPaymentId: null,
      },
    };
  });

  const data = [...pkgRows, ...liveRows, ...tsRows, ...orderlessPkgRows, ...orderlessTsRows]
    .sort((a, b) => (b.purchasedAt?.getTime() ?? 0) - (a.purchasedAt?.getTime() ?? 0))
    .slice(skip, skip + take);

  return { data, pagination: { total: grandTotal, page, limit, totalPages: Math.ceil(grandTotal / limit) } };
};

// "Track Order" for with-material purchases. Mirrors the books tab's getOrderTrackingMysql DTO
// exactly so the app can reuse BookOrderTrackScreen.
type SubscriptionTracking = {
  orderId: string;
  receiptId: string;
  awb: number | null;
  courier: string | null;
  from: { city: null; hub: null };
  to: { city: string | null; hub: string | null; pincode: string | null };
  consignee: string | null;
  consigneePhone: string | null;
  bookedAt: Date | null;
  currentStatus: string | null;
  orderStatus: string;
  shippedAt: null;
  deliveredAt: null;
  history: Array<{ status: string; location: null; note: null; at: Date | null }>;
};

const addrTo = (a: any) => ({
  city: a?.city ?? null,
  hub: a?.address ?? null,
  pincode: a?.pincode != null ? String(a.pincode) : null,
});

// Shipment tracking for a purchase id; the id prefix picks the source, test series is null.
export const getSubscriptionTrackingMysql = async (
  idStr: string,
  customerId: number
): Promise<SubscriptionTracking | null> => {
  // Test series never ships material.
  if (idStr.startsWith(TSS_ID_PREFIX) || idStr.startsWith(TS_ID_PREFIX)) return null;

  if (idStr.startsWith(PCS_ID_PREFIX)) {
    const subId = parsePhId(idStr.slice(PCS_ID_PREFIX.length));
    if (subId == null) return null;
    const sub = await repo.subscriptionForTracking(subId, customerId);
    if (!sub || sub.materialAmount == null) return null;
    const ship: any =
      sub.customerShipping ??
      (sub.shippingId != null ? await repo.customerAddressById(sub.shippingId) : null) ??
      {};
    const track: any = (sub as any).packageCourseSubscriptionTracking ?? null;
    const status = track?.status ?? null;
    return {
      orderId: String(sub.id),
      receiptId: String(sub.id),
      awb: sub.trackingId != null ? Number(sub.trackingId) : null,
      courier: courierForAwb(sub.trackingId),
      from: { city: null, hub: null },
      to: addrTo(ship),
      consignee: ship?.name ?? null,
      consigneePhone: ship?.phone != null ? String(ship.phone) : null,
      bookedAt: sub.createdAt ?? null,
      currentStatus: status ?? (sub.status ? "verified" : "inactive"),
      orderStatus: sub.status ? "verified" : "inactive",
      shippedAt: null,
      deliveredAt: null,
      history: status ? [{ status, location: null, note: null, at: track?.updated_at ?? track?.created_at ?? null }] : [],
    };
  }

  // Live-course address lives in ws_customer_address, unlike package/course.
  if (idStr.startsWith(LIVE_ID_PREFIX)) {
    const subId = parsePhId(idStr.slice(LIVE_ID_PREFIX.length));
    if (subId == null) return null;
    const sub = await repo.liveSubscriptionForTracking(subId, customerId);
    if (!sub || !sub.withMaterial) return null;
    const addr = sub.shipping != null ? await repo.customerAddressById(sub.shipping) : null;
    const status = (sub as any).trackingRow?.status ?? null;
    return {
      orderId: String(sub.id),
      receiptId: String(sub.id),
      awb: sub.tracking != null ? Number(sub.tracking) : null,
      courier: courierForAwb(sub.tracking),
      from: { city: null, hub: null },
      to: addrTo(addr),
      consignee: addr?.name ?? null,
      consigneePhone: addr?.phone != null ? String(addr.phone) : null,
      // The order's `updated_at` is its paid-at (no paid_at column).
      bookedAt: sub.order?.updatedAt ?? sub.createdAt ?? null,
      currentStatus: status ?? livePayStatus(sub.order),
      orderStatus: livePayStatus(sub.order),
      shippedAt: null,
      deliveredAt: null,
      history: status ? [{ status, location: null, note: null, at: sub.updatedAt ?? sub.createdAt ?? null }] : [],
    };
  }

  // Unprefixed id = the package/course order id. The dispatch address is on the order's
  // ws_customer_shipping FK or in ws_customer_address (inconsistent across order paths).
  const orderId = parsePhId(idStr);
  if (orderId == null) return null;
  const order = await repo.courseOrderByIdForReceipt(orderId, customerId);
  if (!order) return null;
  const plan = order.planId ? (await repo.pcPlansByIds([order.planId]))[0] : null;
  if (!plan?.withMaterial) return null;
  const track = (await repo.pcTrackingByOrderIds([order.id]))[0] ?? null;
  if (!track) return null;
  const ship: any =
    (order as any).CustomerShipping ??
    (order.shipping != null ? await repo.customerAddressById(order.shipping) : null) ??
    {};
  const status = track.status ?? null;
  return {
    orderId: String(order.id),
    receiptId: order.uniqueId ?? String(order.id),
    awb: track.id != null ? Number(track.id) : null,
    courier: courierForAwb(track.id),
    from: { city: null, hub: null },
    to: addrTo(ship),
    consignee: ship?.name ?? null,
    consigneePhone: ship?.phone != null ? String(ship.phone) : null,
    bookedAt: order.createdAt ?? null,
    currentStatus: status ?? "verified",
    orderStatus: "verified",
    shippedAt: null,
    deliveredAt: null,
    history: status ? [{ status, location: null, note: null, at: track.updated_at ?? track.created_at ?? null }] : [],
  };
};

/** AWB lookup for the /tracking/live guard. */
export const getSubscriptionTrackingLiveMysql = async (
  idStr: string,
  customerId: number
): Promise<{ trackingId: number | null } | null> => {
  const data = await getSubscriptionTrackingMysql(idStr, customerId);
  if (!data) return null;
  return { trackingId: data.awb };
};

const parseOrderItems = (json: string | null): any[] => {
  if (!json) return [];
  try { const a = JSON.parse(json); return Array.isArray(a) ? a : []; } catch { return []; }
};

// order_items shape differs: current orders write `{ bookId, qty, price, ... }`, legacy rows
// `{ item, name, qty, price }`. Accept both.
const itemBookId = (it: any): number | null => {
  const raw = it?.bookId ?? it?.item;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const listBooks = async (customerId: number, statuses: string[], skip: number, take: number, page: number, limit: number, search?: string) => {
  const [orders, total] = await Promise.all([
    repo.listBookOrders(customerId, statuses, skip, take, search),
    repo.countBookOrders(customerId, statuses, search),
  ]);
  // order_items has no thumbnail (and current rows no name), so every referenced book is resolved.
  const itemsByOrder = new Map<number, any[]>();
  orders.forEach((o) => itemsByOrder.set(o.id, parseOrderItems(o.orderItems)));
  const allBookIds = [...new Set([...itemsByOrder.values()].flat().map(itemBookId).filter((x): x is number => x != null))];
  const bookById = new Map((await repo.booksByIds(allBookIds)).map((b) => [b.id, b]));

  const data = orders.map((o) => {
    const rawItems = itemsByOrder.get(o.id) ?? [];
    const books = rawItems.map((it) => {
      const bookId = itemBookId(it);
      const book = bookId != null ? bookById.get(bookId) : null;
      return {
        bookId: bookId != null ? String(bookId) : null,
        name: it.name || book?.name || "Book",
        thumbnail: book?.thumbnail || book?.image || null,
        qty: it.qty != null ? Number(it.qty) : 1,
        price: it.price != null ? Number(it.price) : null,
      };
    });
    const first = books[0];
    const more = books.length - 1;
    const title = first ? (more > 0 ? `${first.name} +${more} more` : first.name) : "Books order";
    return {
      _id: String(o.id),
      title,
      thumbnail: first?.thumbnail ?? null,
      amount: Number(o.amount),
      // Legacy rows may have a null created_at (no DB default).
      purchasedAt: o.createdAt ?? o.orderDate ?? o.paidAt ?? null,
      status: o.status,
      receiptUrl: `${RECEIPT_BASE}/books/${o.id}/receipt`,
      books,
      tracking: {
        // ws_book_tracking stores the AWB only; no courier column.
        trackingId: o.BookTracking?.tracking_id != null ? String(o.BookTracking.tracking_id) : null,
        courier: null,
      },
      meta: {
        receiptId: o.receiptId,
        itemsCount: books.length,
        razorpayOrderId: o.gatewayOrderId ?? null,
        razorpayPaymentId: o.gatewayPaymentId ?? null,
      },
    };
  });
  return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getEbookReceiptMysql = async (orderId: number, customerId: number) => {
  const order = await repo.ebookOrderForReceipt(orderId, customerId);
  if (!order) return null;

  // No ebook_id on the order: hop via the plan, or the subscription for plan-less grants.
  const plan = order.planId ? await repo.planForReceipt(order.planId) : null;
  const resolvedEbookId = plan?.ebookId ?? (await repo.ebookIdBySubForOrder(order.id))?.ebookId ?? null;
  const ebook = resolvedEbookId ? await repo.ebookById(resolvedEbookId) : null;

  return {
    kind: "ebook" as const,
    receiptId: String(order.id),
    purchasedAt: order.createdAt ?? null,
    paidAt: order.updatedAt ?? null,
    status: order.status,
    customer: { id: order.userId != null ? String(order.userId) : "" },
    payment: {
      method: formatPaymentMethod(order.paymentMethod) || "Online",
      razorpayOrderId: order.gatewayOrderId ?? null,
      razorpayPaymentId: order.gatewayPaymentId ?? null,
      transactionId: order.bankTransactionId || null,
    },
    items: [
      {
        name: ebook?.name || "E-Book purchase",
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
      transactionId: order.bankTransactionId || null,
    },
  };
};

// ws_book_order stores only `amount`; there is no discount/shipping breakdown, so totals collapse to it.
export const getBookReceiptMysql = async (orderId: number, customerId: number) => {
  const o = await repo.bookOrderForReceipt(orderId, customerId);
  if (!o) return null;

  const rawItems = parseOrderItems(o.orderItems);
  const missingIds = [...new Set(rawItems.filter((it) => !it.name).map(itemBookId).filter((x): x is number => x != null))];
  const nameById = new Map((await repo.booksByIds(missingIds)).map((b) => [b.id, b.name]));
  const items = rawItems.map((it) => {
    const bookId = itemBookId(it);
    const name = it.name ?? (bookId != null ? nameById.get(bookId) : null) ?? null;
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
      method: formatPaymentMethod(o.paymentMethod) || "Online",
      razorpayOrderId: o.gatewayOrderId ?? null,
      razorpayPaymentId: o.gatewayPaymentId ?? null,
      // ws_book_order has no bank reference column.
      transactionId: null,
    },
    items,
    totals: {
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

// Keyed by the ORDER id (the purchase-history _id), one receipt per purchase. The validity
// window comes from this order's subscription, else the latest active sub for the target.
export const getCourseReceiptMysql = async (orderId: number, customerId: number) => {
  const order = await repo.courseOrderByIdForReceipt(orderId, customerId);
  if (!order) return null;

  const plan = order.planId ? (await repo.pcPlansByIds([order.planId]))[0] : null;
  const courseId = plan?.courseId && plan.courseId > 0 ? plan.courseId : null;
  const packageId = plan?.packageId && plan.packageId > 0 ? plan.packageId : null;
  const [course, pkg, ownSubs] = await Promise.all([
    courseId ? repo.courseForReceipt(courseId) : Promise.resolve(null),
    packageId ? repo.packageForReceipt(packageId) : Promise.resolve(null),
    repo.pcSubsByOrderIds(customerId, [order.id]),
  ]);
  // Legacy folded extension: the fallback query runs only when the order owns no row.
  const ownWin = pickWindowForTarget(ownSubs, courseId, packageId);
  const fallbackSubs = ownWin
    ? []
    : courseId
      ? await repo.pcSubsByCourseIds(customerId, [courseId])
      : packageId
        ? await repo.pcSubsByPackageIds(customerId, [packageId])
        : [];
  const win =
    ownWin ??
    fallbackSubs
      .filter((s) => (courseId ? s.courseId === courseId : s.packageId === packageId))
      .sort((a, b) => (b.endAt?.getTime() ?? 0) - (a.endAt?.getTime() ?? 0))[0] ??
    null;

  const isPackageKind = !courseId && !!pkg;
  const lineName =
    course?.name && pkg?.name
      ? `${course.name} — ${pkg.name}`
      : course?.name || pkg?.name || "Subscription";
  const amount = Number(order.amount ?? 0);

  return {
    kind: isPackageKind ? ("package" as const) : ("course" as const),
    receiptId: order.uniqueId ?? String(order.id),
    purchasedAt: order.createdAt ?? null,
    paidAt: order.createdAt ?? null,
    status: "verified",
    customer: { id: String(order.userId ?? customerId) },
    payment: {
      method: formatPaymentMethod(order.paymentMethod) || "Online",
      razorpayOrderId: order.gatewayOrderId ?? null,
      razorpayPaymentId: order.gatewayPaymentId ?? null,
      transactionId: order.bankTransactionId || null,
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
      courseId: courseId ? String(courseId) : null,
      targetPackageId: packageId ? String(packageId) : null,
      planId: order.planId != null ? String(order.planId) : null,
      duration: plan?.duration ?? null,
      startAt: win?.startAt ?? null,
      endAt: win?.endAt ?? null,
    },
  };
};

// Legacy "pcs_" subs have no order row, so the receipt reads the sub (no razorpay ids).
export const getCourseReceiptBySubMysql = async (subId: number, customerId: number) => {
  const sub = await repo.subscriptionForReceipt(subId, customerId);
  if (!sub) return null;

  const [plan, course, pkg] = await Promise.all([
    sub.planId ? repo.planDurationForReceipt(sub.planId) : Promise.resolve(null),
    sub.courseId ? repo.courseForReceipt(sub.courseId) : Promise.resolve(null),
    sub.packageId ? repo.packageForReceipt(sub.packageId) : Promise.resolve(null),
  ]);

  const isPackageKind = !sub.courseId && !!pkg;
  const lineName =
    course?.name && pkg?.name ? `${course.name} — ${pkg.name}` : course?.name || pkg?.name || "Subscription";
  const amount = Number(sub.amount ?? 0);

  return {
    kind: isPackageKind ? ("package" as const) : ("course" as const),
    receiptId: String(sub.id),
    purchasedAt: sub.createdAt ?? null,
    paidAt: null,
    status: "verified",
    customer: { id: String(sub.customerId) },
    // `payment_type` (backend|online) is all an order-less sub has.
    payment: {
      method: formatPaymentType(sub.payment_type) || "Online",
      razorpayOrderId: null,
      razorpayPaymentId: null,
      transactionId: null,
    },
    items: [{ name: lineName, qty: 1, unitPrice: amount, lineTotal: amount }],
    totals: { subTotal: amount, grandTotal: amount, currency: "INR" as const },
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

// Unlike course/package, this receipt carries the discount split (list price → subTotal,
// discount, paid → grandTotal), all read from the ORDER.
export const getLiveCourseReceiptMysql = async (subId: number, customerId: number) => {
  const sub = await repo.liveSubscriptionForReceipt(subId, customerId);
  if (!sub) return null;

  const [plan, course] = await Promise.all([
    sub.planId ? repo.livePlanForReceipt(sub.planId) : Promise.resolve(null),
    repo.liveCourseForReceipt(sub.liveCourseId),
  ]);

  // No fallback: a receipt for an unlinked row would silently render zeros.
  const pay = sub.order;
  if (!pay) return null;

  const paid = Number(pay.amount ?? 0);
  const subTotal = pay.originalPrice != null ? Number(pay.originalPrice) : paid;
  // `code_discount`, derived by liveSubDiscountAmount for older rows.
  const discount = liveSubDiscountAmount(pay);

  return {
    kind: "live-course" as const,
    receiptId: String(sub.id),
    purchasedAt: sub.createdAt ?? null,
    paidAt: pay.updatedAt ?? null,
    // The order says "complete"; the receipt has always said "verified".
    status: "verified",
    customer: { id: String(sub.customerId) },
    payment: {
      method: formatPaymentMethod(pay.paymentMethod) || "Online",
      razorpayOrderId: pay.razorpayOrderId ?? null,
      razorpayPaymentId: pay.razorpayPaymentId ?? null,
      transactionId: pay.bankTransactionId || null,
    },
    items: [
      {
        name: course?.name ? `Live Course: ${course.name}` : "Live Course subscription",
        qty: 1,
        unitPrice: subTotal,
        lineTotal: subTotal,
      },
    ],
    totals: {
      subTotal,
      discount,
      grandTotal: paid,
      currency: "INR" as const,
    },
    extra: {
      liveCourseId: String(sub.liveCourseId),
      planId: sub.planId != null ? String(sub.planId) : null,
      duration: plan?.duration ?? null,
      startAt: sub.startAt ?? null,
      endAt: sub.endAt ?? null,
      withMaterial: sub.withMaterial ?? false,
    },
  };
};

// Keyed by the test-series ORDER id (the "ts_"-stripped _id). The validity window comes from
// this order's subscription, else the latest one for the series.
export const getTestSeriesReceiptMysql = async (orderId: number, customerId: number) => {
  const order = await repo.testSeriesOrderByIdForReceipt(orderId, customerId);
  if (!order) return null;

  const [plan, ts, subs] = await Promise.all([
    order.planId ? repo.testSeriesPlanForReceipt(order.planId) : Promise.resolve(null),
    repo.testSeriesForReceipt(order.testSeriesId),
    repo.tsSubsForSeries(customerId, [order.testSeriesId]),
  ]);
  const win =
    subs.find((s) => s.orderId === order.id) ??
    subs
      .filter((s) => s.testSeriesId === order.testSeriesId)
      .sort((a, b) => (b.endAt?.getTime() ?? 0) - (a.endAt?.getTime() ?? 0))[0] ??
    null;

  const total = order.amount != null ? Number(order.amount) : 0;

  return {
    kind: "test-series" as const,
    receiptId: String(order.id),
    purchasedAt: order.createdAt ?? null,
    paidAt: order.createdAt ?? null,
    status: "verified",
    customer: { id: String(order.customerId) },
    payment: {
      // A missing method is not evidence of a gateway.
      method: formatPaymentMethod(order.paymentMethod) || "Online",
      razorpayOrderId: order.razorpayOrderId ?? null,
      razorpayPaymentId: order.razorpayPaymentId ?? null,
      transactionId: order.bankTransactionId || null,
    },
    items: [
      {
        name: ts?.title || "Test Series subscription",
        qty: 1,
        unitPrice: total,
        lineTotal: total,
      },
    ],
    totals: {
      subTotal: total,
      grandTotal: total,
      currency: "INR" as const,
    },
    extra: {
      testSeriesId: String(order.testSeriesId),
      planId: order.planId != null ? String(order.planId) : null,
      duration: plan?.durationDays ?? null,
      startAt: win?.startAt ?? null,
      endAt: win?.endAt ?? null,
    },
  };
};

// Legacy "tss_" order-less subs.
export const getTestSeriesReceiptBySubMysql = async (subId: number, customerId: number) => {
  const sub = await repo.testSeriesSubscriptionForReceipt(subId, customerId);
  if (!sub) return null;

  const [plan, ts] = await Promise.all([
    sub.planId ? repo.testSeriesPlanForReceipt(sub.planId) : Promise.resolve(null),
    repo.testSeriesForReceipt(sub.testSeriesId),
  ]);
  const total = sub.amount != null ? Number(sub.amount) : 0;

  return {
    kind: "test-series" as const,
    receiptId: String(sub.id),
    purchasedAt: sub.createdAt ?? null,
    paidAt: sub.createdAt ?? null,
    status: sub.status ? "verified" : "inactive",
    customer: { id: String(sub.customerId) },
    payment: {
      method: formatPaymentType(sub.paymentType) || "Online",
      razorpayOrderId: null,
      razorpayPaymentId: null,
      transactionId: null,
    },
    items: [{ name: ts?.title || "Test Series subscription", qty: 1, unitPrice: total, lineTotal: total }],
    totals: { subTotal: total, grandTotal: total, currency: "INR" as const },
    extra: {
      testSeriesId: String(sub.testSeriesId),
      planId: sub.planId != null ? String(sub.planId) : null,
      duration: plan?.durationDays ?? null,
      startAt: sub.startAt ?? null,
      endAt: sub.endAt ?? null,
    },
  };
};

export const listEbooks = async (customerId: number, status: string, skip: number, take: number, page: number, limit: number, search?: string) => {
  // ws_ebook_order has no ebook_id/title, so name search resolves to plan ids.
  let planIdsFilter: number[] | undefined;
  if (search) {
    const ebookIds = (await repo.ebookIdsByName(search)).map((e) => e.id);
    planIdsFilter = (await repo.planIdsByEbookIds(ebookIds)).map((p) => p.id);
    if (!planIdsFilter.length) {
      return { data: [], pagination: { total: 0, page, limit, totalPages: 0 } };
    }
  }
  const [orders, total] = await Promise.all([
    repo.listEbookOrders(customerId, status, skip, take, planIdsFilter),
    repo.countEbookOrders(customerId, status, planIdsFilter),
  ]);
  const planIds = [...new Set(orders.map((o) => o.planId).filter((x): x is number => x != null && x > 0))];
  const plans = new Map((await repo.plansByIds(planIds)).map((p) => [p.id, p]));

  // start_at = purchase-date proxy for legacy NULL created_at; ebook_id covers plan-less
  // grants; end_at is the expiry shown on screen.
  const startByOrder = new Map<number, Date>();
  const endByOrder = new Map<number, Date>();
  const ebookIdByOrder = new Map<number, number>();
  for (const s of await repo.ebookSubStartByOrderIds(orders.map((o) => o.id))) {
    if (s.orderId == null) continue;
    if (s.startAt) {
      const cur = startByOrder.get(s.orderId);
      if (!cur || s.startAt < cur) startByOrder.set(s.orderId, s.startAt); // earliest
    }
    if (s.endAt) {
      const cur = endByOrder.get(s.orderId);
      if (!cur || s.endAt > cur) endByOrder.set(s.orderId, s.endAt); // latest
    }
    if (s.ebookId != null && s.ebookId > 0 && !ebookIdByOrder.has(s.orderId)) ebookIdByOrder.set(s.orderId, s.ebookId);
  }

  const ebookIds = [...new Set([
    ...[...plans.values()].map((p) => p.ebookId),
    ...ebookIdByOrder.values(),
  ].filter((x): x is number => x != null && x > 0))];
  const ebooks = new Map((await repo.ebooksByIds(ebookIds)).map((e) => [e.id, e]));

  const data = orders.map((o) => {
    const plan = o.planId ? plans.get(o.planId) : null;
    const resolvedEbookId = plan?.ebookId ?? ebookIdByOrder.get(o.id) ?? null;
    const ebook = resolvedEbookId ? ebooks.get(resolvedEbookId) : null;
    return {
      _id: String(o.id),
      title: ebook?.name || "E-Book purchase",
      author: ebook?.author || null,
      thumbnail: ebook?.thumbnail || null,
      amount: o.orderPrice,
      purchasedAt: o.createdAt ?? startByOrder.get(o.id) ?? o.updatedAt ?? null,
      endAt: endByOrder.get(o.id) ?? null,
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
