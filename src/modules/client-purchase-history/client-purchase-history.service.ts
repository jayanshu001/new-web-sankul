import { clientPurchaseHistoryRepository as repo } from "./client-purchase-history.repository";
import { formatPaymentMethod, formatPaymentType, resolvePaymentReference } from "../../utils/paymentMethod";
import { COURIER } from "../../config/courier";
import { liveSubDiscountAmount } from "../live-course-order/live-course-order.service";

export const PURCHASE_HISTORY_MODULE = "client-purchase-history";
export const isPurchaseHistoryMysql = (): boolean => true;

export const parsePhId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const RECEIPT_BASE = "/api/v1/client/purchase-history";

/**
 * Live-course ORDER status → the subscription vocabulary this API has always emitted.
 * Payment moved to ws_live_course_order on 2026-08-25 and the subscription's own
 * `payment_status` column was dropped, so the order is the only source. Defaults to
 * "verified": every caller here is already gated to a completed order.
 */
// 'cancel' is the ws_package_course_order spelling this table adopted 2026-08-27 for
// what it stored as 'failed'; the wire value stays "failed".
const livePayStatus = (order: { status: string } | null | undefined): string =>
  order == null || order.status === "complete" ? "verified"
  : order.status === "cancel" ? "failed"
  : order.status;

// Carrier key derived from the AWB range (same threshold buildTrackingUrl routes on):
// at/above the Tirupati INITIAL_Number → "tirupati", below → "mahavir". null when no
// AWB has been allocated. Books return courier:null on SQL; we surface the derived key
// so the subscriptions `tracking` object carries the same courier vocabulary the FE uses.
const courierForAwb = (awb: number | bigint | null | undefined): string | null => {
  if (awb == null) return null;
  return Number(awb) >= COURIER.TIRUPATI.INITIAL_Number ? "tirupati" : "mahavir";
};

// ── subscriptions tab ──────────────────────────────────────────────────────────
// The tab UNIONS three independent tables:
//  - ws_package_course_subscription → course/package subs (badge via PackageType)
//  - ws_live_course_subscription    → live-course subs (single-table; badge "Live")
//  - ws_test_series_subscription    → test-series subs (single-table; badge "Test Series")
// Since each table has its own integer PK space, live rows carry a "lc_"-prefixed and
// test-series rows a "ts_"-prefixed _id / receipt path so /subscriptions/:id/receipt can
// disambiguate. All tables are over-fetched to (skip+take), merged by purchasedAt desc,
// then sliced so pagination is correct even when the top rows all come from one table.
const LIVE_ID_PREFIX = "lc_";
const TS_ID_PREFIX = "ts_";
// Order-less LEGACY subscriptions (pre-migration purchases with no SQL order) keep a
// sub-based id under a distinct prefix so /subscriptions/:id/{receipt,tracking} route
// to the sub path. SQL-native purchases + manual grants always have an order → plain id.
const PCS_ID_PREFIX = "pcs_";
const TSS_ID_PREFIX = "tss_";

/**
 * Pick one entitlement window out of the rows an order owns: the row pointing at the
 * order's own plan target, newest `end_at` first. `courseId` wins over `packageId` for
 * the same reason the row builder prefers it — a plan carrying both is a course plan.
 * Returns undefined when the order owns no row for that target (legacy folded
 * extension), which is what hands over to the per-target fallback.
 */
type PcWindow = { orderId: number | null; courseId: number | null; packageId: number | null; startAt: Date | null; endAt: Date | null };
const pickWindowForTarget = (rows: readonly PcWindow[] | undefined, courseId: number | null, packageId: number | null): PcWindow | undefined => {
  if (!rows?.length) return undefined;
  const matches = rows.filter((s) => (courseId ? s.courseId === courseId : packageId ? s.packageId === packageId : true));
  if (!matches.length) return undefined;
  return matches.reduce((best, s) => ((s.endAt?.getTime() ?? 0) > (best.endAt?.getTime() ?? 0) ? s : best));
};

export const listSubscriptions = async (customerId: number, skip: number, take: number, page: number, limit: number) => {
  const overFetch = skip + take;
  // Package/course + test-series list from their ORDER tables so each purchase (incl.
  // a validity extension) is its own row — the entitlement subscription still folds,
  // that is untouched. Live-course already lists per-purchase from its sub table.
  // Legacy purchases (subs with no order) are unioned back in so history isn't lost.
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

  // ── name/window resolution: THREE dependency rounds, not eight round trips ──────
  // These lookups used to `await` one at a time. Only three of them actually depend on
  // an earlier result (order → plan → course/package → type), so the rest were paying
  // a full DB round trip each for nothing. Grouped by real dependency depth:
  //
  //   round 1  plans, liveCourses, testSeries, tracking, ownSubs — need only stage-A rows
  //   round 2  courses, packages, tsSubs                         — need plans / testSeries
  //   round 3  types (+ the legacy window fallback, usually skipped) — need packages / plans
  //
  // Keep new lookups in the shallowest round they belong to; adding one to a later
  // round costs a round trip even when nothing in it is a dependency. `ownSubs` moved
  // UP to round 1 on 2026-08-27: keying the window on order_id instead of on the page's
  // course/package targets removed its dependency on rounds 1–2 entirely.

  // test-series ids come from the stage-A rows directly (no plan hop), so this is
  // available before round 1 — that is what lets testSeries load in round 1.
  const tsIds = new Set<number>([...tsOrders.map((o) => o.testSeriesId), ...olTsSubs.map((s) => s.testSeriesId)].filter((x): x is number => x != null && x > 0));

  const pcOrderIds = pcOrders.map((o) => o.id);

  const [plans, liveCourses, testSeries, trackingByOrder, ownSubs] = await Promise.all([
    // Resolve the order's plan → course/package target (title, badge, kind).
    repo.pcPlansByIds([...new Set(pcOrders.map((o) => o.planId).filter((x): x is number => x != null && x > 0))]).then((r) => new Map(r.map((p) => [p.id, p]))),
    repo.liveCoursesByIds([...new Set(liveSubs.map((s) => s.liveCourseId).filter((x): x is number => x != null && x > 0))]).then((r) => new Map(r.map((c) => [c.id, c]))),
    repo.testSeriesByIds([...tsIds]).then((r) => new Map(r.map((t) => [t.id, t]))),
    // Shipment tracking rows are keyed by the ORDER that created them (material orders).
    repo.pcTrackingByOrderIds(pcOrderIds).then((r) => new Map(r.map((t) => [t.orderId, t]))),
    // Validity window for the orders that own a subscription row — one indexed seek
    // per order id, NOT a scan of the customer's whole entitlement history.
    repo.pcSubsByOrderIds(customerId, pcOrderIds),
  ]);
  // Grouped, not keyed 1:1 — a customer CAN carry more than one active row against the
  // same order_id in legacy data, and the old code let whichever row the driver returned
  // last silently win. Pick the row that matches the order's own plan target, newest
  // window first, so the choice is deterministic.
  const subsByOrder = new Map<number, PcWindow[]>();
  for (const s of ownSubs) {
    const k = s.orderId as number;
    const bucket = subsByOrder.get(k);
    if (bucket) bucket.push(s);
    else subsByOrder.set(k, [s]);
  }

  // Course/package ids come from BOTH the order plans and the order-less subs (which
  // carry course_id/package_id directly).
  const courseIds = new Set<number>([...[...plans.values()].map((p) => p.courseId), ...olSubs.map((s) => s.courseId)].filter((x): x is number => x != null && x > 0));
  const packageIds = new Set<number>([...[...plans.values()].map((p) => p.packageId), ...olSubs.map((s) => s.packageId)].filter((x): x is number => x != null && x > 0));

  const [courses, packages, tsSubs] = await Promise.all([
    repo.coursesByIds([...courseIds]).then((r) => new Map(r.map((c) => [c.id, c]))),
    repo.packagesByIds([...packageIds]).then((r) => new Map(r.map((p) => [p.id, p]))),
    // Test-series validity window per order (fold-aware, same as package/course).
    repo.tsSubsForSeries(customerId, [...testSeries.keys()]),
  ]);

  // LEGACY window fallback, scoped to the orders that actually need it. A pre-2026-08-25
  // validity extension folded onto the entitlement subscription and owns no row of its
  // own, so its window comes from the customer's latest active sub for the same target.
  // Only those orders contribute a target here, so a page of SQL-native purchases issues
  // neither query — and each target column is queried separately so both can seek an
  // index (a single OR over the two cannot; that was the unbounded read).
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
  // Same keying rule as before the split: a sub carrying BOTH ids keys on the course.
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
    // With-material = the order's plan carries material. The shipment AWB/status live on
    // the tracking row created at verify (keyed by order id) — only fresh material orders
    // get one (an extension folds and creates no new kit), so tracking may be null.
    const withMaterial = !!plan?.withMaterial;
    const track = trackingByOrder.get(o.id) ?? null;
    const tracking =
      withMaterial && track
        ? { trackingId: String(track.id), courier: courierForAwb(track.id) }
        : null;
    // Validity window (cumulative on the entitlement sub) for this purchase's card.
    const win =
      pickWindowForTarget(subsByOrder.get(o.id), courseId, packageId) ??
      (courseId ? latestSubByKey.get(`c:${courseId}`) : packageId ? latestSubByKey.get(`p:${packageId}`) : null) ??
      null;
    return {
      _id: String(o.id),
      kind: courseId ? "course" : "package",
      title: course?.name || pkg?.name || "Subscription",
      author: null, // ws_course has no author column (Mongo-only)
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
        // ws_package_course_order carries the real razorpay ids (unlike the sub).
        razorpayOrderId: o.gatewayOrderId ?? null,
        razorpayPaymentId: o.gatewayPaymentId ?? null,
      },
    };
  });

  const liveRows = liveSubs.map((s) => {
    const lc = s.liveCourseId ? liveCourses.get(s.liveCourseId) : null;
    // Live-course carries with_material inline (no plan flag); the AWB + status are
    // inline columns (allocated at verify for material orders) — no separate table.
    const withMaterial = !!s.withMaterial;
    // `s.tracking` is the column (renamed from tracking_id on 2026-08-27 to match
    // ws_package_course_subscription.tracking); the DTO key stays `trackingId`.
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
      // Dispatch status lives on the tracking row since 2026-08-27 (c).
      status: withMaterial ? ((s as any).trackingRow?.status ?? null) : null,
      tracking,
      // `amount` = ws_live_course_order.discount_price (2026-08-27 package shape).
      amount: s.order?.amount != null ? Number(s.order.amount) : null,
      purchasedAt: s.createdAt ?? s.startAt ?? null,
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      receiptUrl: `${RECEIPT_BASE}/subscriptions/${LIVE_ID_PREFIX}${s.id}/receipt`,
      meta: {
        liveCourseId: s.liveCourseId != null && s.liveCourseId > 0 ? String(s.liveCourseId) : null,
        planId: s.planId != null && s.planId > 0 ? String(s.planId) : null,
        // The razorpay ids are surfaced here (unlike the package sub); they live on
        // the live-course ORDER since 2026-08-25.
        razorpayOrderId: s.order?.razorpayOrderId ?? null,
        razorpayPaymentId: s.order?.razorpayPaymentId ?? null,
      },
    };
  });

  // `tsSubs` was fetched in round 2 above (it only needs `testSeries`).
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
      // Test series never ships physical material — no Track Order.
      withMaterial: false,
      status: null,
      tracking: null,
      amount: o.orderPrice != null ? Number(o.orderPrice) : null,
      purchasedAt: o.createdAt ?? null,
      startAt: win?.startAt ?? null,
      endAt: win?.endAt ?? null,
      receiptUrl: `${RECEIPT_BASE}/subscriptions/${TS_ID_PREFIX}${o.id}/receipt`,
      meta: {
        testSeriesId: o.testSeriesId != null && o.testSeriesId > 0 ? String(o.testSeriesId) : null,
        planId: o.planId != null && o.planId > 0 ? String(o.planId) : null,
        // ws_test_series_order carries the razorpay ids directly.
        razorpayOrderId: o.razorpayOrderId ?? null,
        razorpayPaymentId: o.razorpayPaymentId ?? null,
      },
    };
  });

  // Legacy package/course subs (no order) — sub-based rows, "pcs_"-prefixed id.
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

  // Legacy test-series subs (no order) — sub-based rows, "tss_"-prefixed id.
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
      amount: s.price != null ? Number(s.price) : null,
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

// ── subscription material shipment tracking (SQL) ────────────────────────────
// Client "Track Order" for with-material package/course + live-course purchases.
// Mirrors the Books tab's getOrderTrackingMysql DTO EXACTLY so the app can reuse
// BookOrderTrackScreen. The `_id` from the subscriptions list carries the "lc_"
// prefix for live subs (separate table) and no prefix for package/course; "ts_"
// (test series) is never material → not trackable.
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

export const getSubscriptionTrackingMysql = async (
  idStr: string,
  customerId: number
): Promise<SubscriptionTracking | null> => {
  // Test-series never ships material ("ts_" order id or "tss_" legacy sub id).
  if (idStr.startsWith(TSS_ID_PREFIX) || idStr.startsWith(TS_ID_PREFIX)) return null;

  // Legacy package/course sub (no order, "pcs_"-prefixed) — sub-based tracking.
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

  // Live-course (prefixed id): AWB + status are inline columns; address lives in
  // ws_customer_address (customer_shipping_id), a different table than package/course.
  if (idStr.startsWith(LIVE_ID_PREFIX)) {
    const subId = parsePhId(idStr.slice(LIVE_ID_PREFIX.length));
    if (subId == null) return null;
    const sub = await repo.liveSubscriptionForTracking(subId, customerId);
    // Trackable only for with-material orders (AWB allocated at verify for those).
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
      // Payment instant + state come off the ORDER since 2026-08-25. The row is
      // already gated to a completed order by liveSubscriptionPurchasedWhere, so the
      // mapped state is "verified" — the same value this DTO has always emitted.
      // `paid_at` was dropped 2026-08-27 — `updated_at` is the order's paid-at (verify
      // stamped both with the same `now`), which is how the package receipt reads it.
      bookedAt: sub.order?.updatedAt ?? sub.createdAt ?? null,
      currentStatus: status ?? livePayStatus(sub.order),
      orderStatus: livePayStatus(sub.order),
      shippedAt: null,
      deliveredAt: null,
      history: status ? [{ status, location: null, note: null, at: sub.updatedAt ?? sub.createdAt ?? null }] : [],
    };
  }

  // Package/course PURCHASE ORDER (unprefixed id = the order id the list emits). The
  // shipment status row is keyed by order id and created at verify only for a FRESH
  // material order (an extension folds and ships no new kit → not trackable). The
  // dispatch address is on the order's ws_customer_shipping FK, or ws_customer_address
  // (inconsistent across order paths) — fall back like elsewhere.
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

/** Minimal AWB lookup for the /tracking/live guard (mirrors getOrderTrackingLiveMysql). */
export const getSubscriptionTrackingLiveMysql = async (
  idStr: string,
  customerId: number
): Promise<{ trackingId: number | null } | null> => {
  const data = await getSubscriptionTrackingMysql(idStr, customerId);
  if (!data) return null;
  return { trackingId: data.awb };
};

// ── books tab ────────────────────────────────────────────────────────────────
const parseOrderItems = (json: string | null): any[] => {
  if (!json) return [];
  try { const a = JSON.parse(json); return Array.isArray(a) ? a : []; } catch { return []; }
};

// Resolve a line item's book id regardless of order_items shape. SQL-created
// orders write `{ bookId, qty, price, ... }` (from CreateOrderItemInput); legacy
// Mongo-migrated rows used `{ item, name, qty, price }`. Accept both → the numeric
// book id, or null when it can't be resolved.
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
  // The order_items JSON carries the priced lines (bookId + qty + price) but NO
  // book name/thumbnail, so resolve EVERY referenced book (not just the first) to
  // render each line's real title + thumbnail. Legacy rows use {item,name}; SQL
  // rows use {bookId} — itemBookId handles both.
  const itemsByOrder = new Map<number, any[]>();
  orders.forEach((o) => itemsByOrder.set(o.id, parseOrderItems(o.orderItems)));
  const allBookIds = [...new Set([...itemsByOrder.values()].flat().map(itemBookId).filter((x): x is number => x != null))];
  const bookById = new Map((await repo.booksByIds(allBookIds)).map((b) => [b.id, b]));

  const data = orders.map((o) => {
    const rawItems = itemsByOrder.get(o.id) ?? [];
    // Full per-book detail for the order — the app renders this list instead of a
    // bare "Book" placeholder. Name backfilled from ws_book when the JSON omits it.
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
      // Legacy rows may have a null created_at (no DB default) — fall back to
      // order_date, then paid_at, so the purchase date still renders.
      purchasedAt: o.createdAt ?? o.orderDate ?? o.paidAt ?? null,
      status: o.status,
      receiptUrl: `${RECEIPT_BASE}/books/${o.id}/receipt`,
      // Every book in the order, with proper details (name/thumbnail/qty/price).
      books,
      tracking: {
        // ws_book_tracking is a flat status row → AWB only; no courier column.
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

// ── ebook receipt (SQL mirror of getEbookReceipt) ────────────────────────────
// The only receipt endpoint with full column parity on SQL: book + course
// receipts read breakdown/paidAt/razorpay fields that ws_book_order /
// ws_package_course_subscription don't carry — those stay Mongo for now.
export const getEbookReceiptMysql = async (orderId: number, customerId: number) => {
  const order = await repo.ebookOrderForReceipt(orderId, customerId);
  if (!order) return null;

  // ws_ebook_order has no ebook_id → hop plan_id → price.ebook_id → ebook. For
  // plan-less orders (manual grants) fall back to the subscription's ebook_id.
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

// ── book receipt (SQL mirror of getBookReceipt) ──────────────────────────────
// DRIFT: ws_book_order carries only `amount` (order_price) — there is NO
// total_discounted_price / total_shipping_price / total_list_price column, so
// the discount/shipping split is not stored on SQL and collapses to amount.
export const getBookReceiptMysql = async (orderId: number, customerId: number) => {
  const o = await repo.bookOrderForReceipt(orderId, customerId);
  if (!o) return null;

  const rawItems = parseOrderItems(o.orderItems);
  // backfill missing names via a Book lookup. SQL rows carry the id as `bookId`
  // (no name); legacy rows as `item` — itemBookId resolves either.
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
      // ws_book_order has no bank reference column (its transaction_id was
      // dropped), so a bank-paid book order genuinely has nothing to show here.
      transactionId: null,
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

// ── course/package receipt (ORDER-based — one receipt per purchase) ──────────
// Keyed by the ORDER id now surfaced as the purchase-history _id, so a validity
// extension has its own receipt. The order carries amount + razorpay ids + dates
// directly; the validity window is read from the entitlement sub this order fed
// (fresh → by order id; extension → the customer's latest active sub for the target).
export const getCourseReceiptMysql = async (orderId: number, customerId: number) => {
  const order = await repo.courseOrderByIdForReceipt(orderId, customerId);
  if (!order) return null;

  const plan = order.planId ? (await repo.pcPlansByIds([order.planId]))[0] : null;
  const courseId = plan?.courseId && plan.courseId > 0 ? plan.courseId : null;
  const packageId = plan?.packageId && plan.packageId > 0 ? plan.packageId : null;
  const [course, pkg, ownSubs] = await Promise.all([
    courseId ? repo.courseForReceipt(courseId) : Promise.resolve(null),
    packageId ? repo.packageForReceipt(packageId) : Promise.resolve(null),
    // Fresh purchase → the subscription row THIS order created (indexed seek on
    // order_id). Same bounded lookup the list uses; the old target-scoped read
    // loaded every active subscription the customer owns for this course/package.
    repo.pcSubsByOrderIds(customerId, [order.id]),
  ]);
  // Legacy folded extension: no own row, so fall back to the latest active sub for the
  // same target. The fallback query is issued ONLY when the order owns no row.
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
      // Was hardcoded "razorpay" — a bank/cash/backend order reported the wrong
      // method on the receipt screen while the PDF showed the real one.
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

// ── course/package receipt (SUB-based — legacy "pcs_" orders-less subs) ──────
// Legacy pre-migration subs have no order row, so their receipt reads the sub
// directly (razorpay ids unavailable → null). Same output shape as the order path.
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
    // Legacy order-less sub: `payment_type` (backend|online) is all there is —
    // report that instead of claiming a gateway that was never involved.
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

// ── live-course receipt (SQL) ────────────────────────────────────────────────
// UNLIKE course/package, this receipt has FULL parity: real razorpay ids, paidAt,
// and the discount split (original_amount → subTotal, derived discount, paid_amount
// → grandTotal). All of it reads from the ORDER (2026-08-25).
export const getLiveCourseReceiptMysql = async (subId: number, customerId: number) => {
  const sub = await repo.liveSubscriptionForReceipt(subId, customerId);
  if (!sub) return null;

  const [plan, course] = await Promise.all([
    sub.planId ? repo.livePlanForReceipt(sub.planId) : Promise.resolve(null),
    repo.liveCourseForReceipt(sub.liveCourseId),
  ]);

  // Payment moved to ws_live_course_order on 2026-08-25 and the subscription's own
  // payment columns were dropped, so the order is the only source. No fallback: a
  // receipt for an unlinked row would silently render zeros, which is worse than
  // reporting it as unavailable.
  const pay = sub.order;
  if (!pay) return null;

  const paid = Number(pay.amount ?? 0);
  // `price` is the plan list price and is written on EVERY order since 2026-08-27
  // (package semantics). It used to be `original_amount`, set only on a promo — for
  // those rows subTotal fell back to `paid`, which equalled the list price anyway,
  // so this line's value is unchanged either way.
  const subTotal = pay.originalPrice != null ? Number(pay.originalPrice) : paid;
  // Stored in `code_discount` since 2026-08-27; liveSubDiscountAmount still derives
  // it for older rows. Same value the dropped column held; the receipt is unchanged.
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
      // The order carries its own payment_method + bank_transaction_id; this was
      // hardcoded "razorpay" once and ignored both.
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

// ── test-series receipt (ORDER-based — one receipt per purchase) ─────────────────
// Keyed by the test-series ORDER id (the list's "ts_"-stripped _id) so each extension
// has its own receipt. The order carries price + razorpay ids directly; the validity
// window comes from the entitlement sub (fresh by order id, else latest for the series).
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

  const total = order.orderPrice != null ? Number(order.orderPrice) : 0;

  return {
    kind: "test-series" as const,
    receiptId: String(order.id),
    purchasedAt: order.createdAt ?? null,
    paidAt: order.createdAt ?? null,
    status: "verified",
    customer: { id: String(order.customerId) },
    payment: {
      // Fallback was "razorpay"; a missing method is not evidence of a gateway.
      method: formatPaymentMethod(order.paymentMethod) || "Online",
      razorpayOrderId: order.razorpayOrderId ?? null,
      razorpayPaymentId: order.razorpayPaymentId ?? null,
      transactionId: order.transactionId || null,
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

// ── test-series receipt (SUB-based — legacy "tss_" order-less subs) ──────────────
export const getTestSeriesReceiptBySubMysql = async (subId: number, customerId: number) => {
  const sub = await repo.testSeriesSubscriptionForReceipt(subId, customerId);
  if (!sub) return null;

  const [plan, ts] = await Promise.all([
    sub.planId ? repo.testSeriesPlanForReceipt(sub.planId) : Promise.resolve(null),
    repo.testSeriesForReceipt(sub.testSeriesId),
  ]);
  const total = sub.price != null ? Number(sub.price) : 0;

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

// ── ebooks tab ─────────────────────────────────────────────────────────────────
export const listEbooks = async (customerId: number, status: string, skip: number, take: number, page: number, limit: number, search?: string) => {
  // Name search: ws_ebook_order carries no ebook_id/title, so resolve matching
  // ebook names → their price (plan) ids and constrain the order query by plan_id.
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
  // ws_ebook_order has no ebook_id → hop order.plan_id → price.ebook_id → ebook.
  const planIds = [...new Set(orders.map((o) => o.planId).filter((x): x is number => x != null && x > 0))];
  const plans = new Map((await repo.plansByIds(planIds)).map((p) => [p.id, p]));

  // Subscription per order: start_at is the purchase-date proxy for legacy orders
  // whose created_at is NULL; ebook_id resolves the ebook for plan-less orders
  // (manual grants) whose order.plan_id → ebook hop yields nothing.
  const startByOrder = new Map<number, Date>();
  const ebookIdByOrder = new Map<number, number>();
  for (const s of await repo.ebookSubStartByOrderIds(orders.map((o) => o.id))) {
    if (s.orderId == null) continue;
    if (s.startAt) {
      const cur = startByOrder.get(s.orderId);
      if (!cur || s.startAt < cur) startByOrder.set(s.orderId, s.startAt); // earliest
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
    // Prefer the plan hop; fall back to the subscription's ebook_id for plan-less grants.
    const resolvedEbookId = plan?.ebookId ?? ebookIdByOrder.get(o.id) ?? null;
    const ebook = resolvedEbookId ? ebooks.get(resolvedEbookId) : null;
    return {
      _id: String(o.id),
      title: ebook?.name || "E-Book purchase",
      author: ebook?.author || null,
      thumbnail: ebook?.thumbnail || null,
      amount: o.orderPrice,
      // created_at (true order time) first; for legacy NULL rows fall back to the
      // subscription's start_at (≈ purchase date), then updated_at.
      purchasedAt: o.createdAt ?? startByOrder.get(o.id) ?? o.updatedAt ?? null,
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
