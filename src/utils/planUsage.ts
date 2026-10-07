// Plan usage: all-time order count per pricing plan (gates plan delete).
import { prisma } from "../config/prisma";

/**
 * All-time order count per pricing plan. A plan may be deleted only while it is 0;
 * list rows expose it as `orderCount` so the panel can disable Delete.
 *
 * Status-blind by contract: expired, cancelled and pending purchases all pin the
 * plan. Do not add a `status` / `endAt` / `paymentStatus` filter; that narrowing
 * is what let sold plans be hard-deleted.
 *
 * Counted as every order plus subscriptions with no order row (`order_id IS NULL`,
 * legacy). Orders alone miss legacy subs; subs alone miss pending/failed orders;
 * summing both would double-count normal sales.
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
 * planId → all-time order count for a page of plan ids (one grouped query per table).
 * Absent ids have zero usage; read `map.get(id) ?? 0`, since the FE treats a
 * missing field as "unknown" and keeps Delete enabled.
 */
export const countPlanUsage = async (
  kind: PlanKindForUsage,
  planIds: number[],
): Promise<Map<number, number>> => {
  const ids = [...new Set(planIds.filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map<number, number>();
  if (!ids.length) return out;

  if (kind === "livePlan") {
    // A pending checkout writes only an order, not a subscription, so orders of every
    // status are counted, plus subscriptions not yet linked to an order (disjoint sets).
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

  // ws_package_course_ebook_price backs package, course and ebook plans, so both
  // order tables are consulted. ws_ebook_subscription has no plan_id, so order-less
  // legacy ebook subscriptions cannot be attributed and are not counted.
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

export const countPlanUsageOne = async (
  kind: PlanKindForUsage,
  planId: number,
): Promise<number> => (await countPlanUsage(kind, [planId])).get(planId) ?? 0;

/** Shared by every plan-delete endpoint; the panel shows it verbatim. */
export const planInUseMessage = (count: number): string =>
  `Cannot delete: ${count} order(s) reference this plan. Turn its status off instead.`;
