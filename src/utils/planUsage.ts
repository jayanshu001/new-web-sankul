import { prisma } from "../config/prisma";

/**
 * "How many times has this pricing plan ever been ordered?" — the single number
 * behind the plan-immutability rules (backend-request 2026-08-21):
 *
 *   • a plan may be DELETED only while this is 0
 *   • plan/price list rows expose it as `orderCount` so the panel can grey out
 *     Delete instead of firing a request it knows will 409
 *
 * ALL-TIME and status-blind by contract. An expired subscription, a cancelled
 * one, and a pending order all pin the plan — "zero orders, ever", not "zero
 * active ones". Do not add a `status` / `endAt` / `paymentStatus` filter here;
 * that narrowing is exactly what let sold plans be hard-deleted.
 *
 * ── Why the count is a union, not one table ────────────────────────────────
 * A purchase writes an ORDER and (once settled) a SUBSCRIPTION, so counting both
 * and adding would double every normal sale. But neither table alone is enough:
 *
 *   • orders alone miss LEGACY subscriptions that predate the order table
 *     (`order_id IS NULL`) — they would report 0 and let a sold plan be deleted
 *   • subscriptions alone miss PENDING/FAILED orders, which reference the plan
 *     just as firmly and are the case the live-course guard was missing
 *
 * So: every order, plus only those subscriptions that have no order row. That is
 * the exact union with no double counting, in two grouped queries.
 */
export type PlanKindForUsage = "price" | "livePlan" | "testSeriesPrice";

type CountRow = { planId: number | null; _count: { _all: number } };

const tally = (into: Map<number, number>, rows: CountRow[]) => {
  for (const r of rows) {
    if (r.planId == null) continue;
    into.set(r.planId, (into.get(r.planId) ?? 0) + r._count._all);
  }
  return into;
};

/**
 * planId → all-time order count, for a PAGE of plan ids. One grouped query per
 * source table, never one query per row.
 *
 * Ids absent from the returned map have zero usage; callers should read
 * `map.get(id) ?? 0` so a plan that was never ordered reports `0`, not `undefined`
 * (the FE contract treats a MISSING field as "unknown" and keeps Delete enabled).
 */
export const countPlanUsage = async (
  kind: PlanKindForUsage,
  planIds: number[],
): Promise<Map<number, number>> => {
  const ids = [...new Set(planIds.filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map<number, number>();
  if (!ids.length) return out;

  if (kind === "livePlan") {
    // Live course gained an order table on 2026-08-25, so usage is counted the same
    // way as test-series below: ORDERS of every status (a pending checkout still
    // pins the plan — it no longer writes a subscription row, so counting only
    // subscriptions would let an in-flight purchase's plan be deleted), plus legacy
    // subscriptions the backfill has not linked to an order yet. The two sets are
    // disjoint, so nothing is counted twice.
    const [liveOrders, orphanLiveSubs] = await Promise.all([
      prisma.liveCourseOrder.groupBy({
        by: ["planId"],
        where: { planId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.liveCourseSubscription.groupBy({
        by: ["planId"],
        where: { planId: { in: ids }, orderId: null },
        _count: { _all: true },
      }),
    ]);
    tally(out, liveOrders as unknown as CountRow[]);
    return tally(out, orphanLiveSubs as unknown as CountRow[]);
  }

  if (kind === "testSeriesPrice") {
    const [orders, orphanSubs] = await Promise.all([
      prisma.testSeriesOrder.groupBy({
        by: ["planId"], where: { planId: { in: ids } }, _count: { _all: true },
      }),
      prisma.testSeriesSubscription.groupBy({
        by: ["planId"], where: { planId: { in: ids }, orderId: null }, _count: { _all: true },
      }),
    ]);
    tally(out, orders as unknown as CountRow[]);
    return tally(out, orphanSubs as unknown as CountRow[]);
  }

  // "price" — ws_package_course_ebook_price backs package, course AND ebook plans,
  // so both order tables are consulted. A plan is owned by exactly one product, so
  // the other table simply contributes nothing.
  //
  // ⚠ ws_ebook_subscription has NO plan_id column (it reaches the plan only through
  // its order), so an order-less legacy EBOOK subscription cannot be attributed to a
  // plan and is not counted. Package/course subs do carry `pcb_id` and are.
  const [pcOrders, ebookOrders, orphanPcSubs] = await Promise.all([
    prisma.packageCourseOrder.groupBy({
      by: ["planId"], where: { planId: { in: ids } }, _count: { _all: true },
    }),
    prisma.eBookOrder.groupBy({
      by: ["planId"], where: { planId: { in: ids } }, _count: { _all: true },
    }),
    prisma.packageCourseSubscription.groupBy({
      by: ["planId"], where: { planId: { in: ids }, orderId: null }, _count: { _all: true },
    }),
  ]);
  tally(out, pcOrders as unknown as CountRow[]);
  tally(out, ebookOrders as unknown as CountRow[]);
  return tally(out, orphanPcSubs as unknown as CountRow[]);
};

/** Single-plan convenience for the delete guards. */
export const countPlanUsageOne = async (
  kind: PlanKindForUsage,
  planId: number,
): Promise<number> => (await countPlanUsage(kind, [planId])).get(planId) ?? 0;

/** The refusal message every plan-delete endpoint returns, so the panel can show it verbatim. */
export const planInUseMessage = (count: number): string =>
  `Cannot delete: ${count} order(s) reference this plan. Turn its status off instead.`;
