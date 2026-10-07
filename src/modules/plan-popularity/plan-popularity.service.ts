/**
 * "Most Popular" pricing-plan tag, fully automatic. `is_most_popular` is written
 * only here; no endpoint accepts it.
 *
 * Winner per product: the plan with the most all-time paid orders; tie → lowest
 * price, then lowest id. No sales → no badge.
 *
 * Counting is all-time, so an established plan is hard to unseat. If the badge must
 * track current demand, window the paid-order query (e.g. last 90 days) rather than
 * adding a manual override.
 *
 * Scopes (5 logical modules over 3 plan tables; course/package/ebook share one):
 *   course      : ws_package_course_ebook_price (courseId)  ← paid PackageCourseOrder
 *   package     : ws_package_course_ebook_price (packageId) ← paid PackageCourseOrder
 *   ebook       : ws_package_course_ebook_price (ebookId)   ← paid EBookOrder
 *   liveCourse  : ws_live_course_plan          (liveCourseId) ← complete LiveCourseOrder
 *   testSeries  : ws_test_series_price          (testSeriesId) ← complete TestSeriesOrder
 */
import { prisma } from "../../config/prisma";

export type PopularityScope = "course" | "package" | "ebook" | "liveCourse" | "testSeries";
export const POPULARITY_SCOPES: PopularityScope[] = ["course", "package", "ebook", "liveCourse", "testSeries"];

// price coerced to number (test-series is Decimal).
interface PlanRow { id: number; productId: number; price: number }

function pickWinner(plans: PlanRow[], paidByPlan: Map<number, number>): number | null {
  if (plans.length === 0) return null;
  const withCount = plans.map((p) => ({ ...p, c: paidByPlan.get(p.id) ?? 0 }));
  const max = Math.max(...withCount.map((x) => x.c));
  if (max <= 0) return null; // no sales → no badge
  return withCount.filter((x) => x.c === max).sort((a, b) => a.price - b.price || a.id - b.id)[0].id;
}

async function loadCpe(field: "courseId" | "packageId" | "ebookId", productId?: number) {
  const where: any = { status: true, [field]: productId != null ? productId : { not: null } };
  const plans = await prisma.packageCourseEbookPrice.findMany({
    where, select: { id: true, price: true, courseId: true, packageId: true, ebookId: true },
  });
  const rows: PlanRow[] = plans.map((p) => ({ id: p.id, productId: Number((p as any)[field]), price: p.price }));
  return rows;
}

async function paidCountsCpe(orderModel: "packageCourseOrder" | "eBookOrder", planIds: number[]): Promise<Map<number, number>> {
  if (!planIds.length) return new Map();
  const grouped = await (prisma[orderModel] as any).groupBy({
    by: ["planId"], where: { planId: { in: planIds }, status: "complete" }, _count: { _all: true },
  });
  return new Map(grouped.map((g: any) => [g.planId as number, g._count._all as number]));
}

// Recompute one scope (or one product); returns how many flags flipped.
export async function recomputeScope(scope: PopularityScope, productId?: number): Promise<number> {
  let plans: PlanRow[] = [];
  let paid = new Map<number, number>();

  if (scope === "course" || scope === "package" || scope === "ebook") {
    const field = scope === "course" ? "courseId" : scope === "package" ? "packageId" : "ebookId";
    plans = await loadCpe(field, productId);
    const ids = plans.map((p) => p.id);
    // course & package purchases both live in PackageCourseOrder; ebook in EBookOrder.
    paid = await paidCountsCpe(scope === "ebook" ? "eBookOrder" : "packageCourseOrder", ids);
  } else if (scope === "liveCourse") {
    const rows = await prisma.liveCoursePlan.findMany({
      where: { status: true, ...(productId != null ? { liveCourseId: productId } : {}) },
      select: { id: true, price: true, liveCourseId: true },
    });
    plans = rows.map((p) => ({ id: p.id, productId: p.liveCourseId, price: p.price }));
    const ids = plans.map((p) => p.id);
    if (ids.length) {
      // Counted off the order table so a renewal counts as a sale.
      const grouped = await prisma.liveCourseOrder.groupBy({
        by: ["planId"], where: { planId: { in: ids }, status: "complete" }, _count: { _all: true },
      });
      paid = new Map(grouped.map((g) => [g.planId as number, g._count._all]));
    }
  } else {
    // testSeries: price is Decimal.
    const rows = await prisma.testSeriesPrice.findMany({
      where: { status: true, ...(productId != null ? { testSeriesId: productId } : {}) },
      select: { id: true, price: true, testSeriesId: true },
    });
    plans = rows.map((p) => ({ id: p.id, productId: p.testSeriesId, price: Number(p.price) }));
    const ids = plans.map((p) => p.id);
    if (ids.length) {
      const grouped = await prisma.testSeriesOrder.groupBy({
        by: ["planId"], where: { planId: { in: ids }, status: "complete" }, _count: { _all: true },
      });
      paid = new Map(grouped.map((g) => [g.planId as number, g._count._all]));
    }
  }

  const byProduct = new Map<number, PlanRow[]>();
  for (const p of plans) {
    const a = byProduct.get(p.productId) ?? [];
    a.push(p);
    byProduct.set(p.productId, a);
  }
  const winners = new Set<number>();
  for (const group of byProduct.values()) {
    const w = pickWinner(group, paid);
    if (w != null) winners.add(w);
  }

  // Write only the rows whose flag actually changes (minimise writes).
  const model: any =
    scope === "liveCourse" ? prisma.liveCoursePlan
    : scope === "testSeries" ? prisma.testSeriesPrice
    : prisma.packageCourseEbookPrice;
  const ids = plans.map((p) => p.id);
  if (!ids.length) return 0;
  const current: Array<{ id: number; isMostPopular: boolean }> =
    await model.findMany({ where: { id: { in: ids } }, select: { id: true, isMostPopular: true } });
  let changed = 0;
  for (const row of current) {
    const want = winners.has(row.id);
    if (row.isMostPopular !== want) {
      await model.update({ where: { id: row.id }, data: { isMostPopular: want } });
      changed++;
    }
  }
  return changed;
}

/** Scheduled-job entry point. Returns per-scope change counts. */
export async function recomputeAllPopularity(): Promise<Record<PopularityScope, number>> {
  const out = {} as Record<PopularityScope, number>;
  for (const scope of POPULARITY_SCOPES) out[scope] = await recomputeScope(scope);
  return out;
}
