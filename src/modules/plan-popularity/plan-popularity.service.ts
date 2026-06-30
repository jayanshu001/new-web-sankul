/**
 * "Most Popular" pricing-plan tag — shared recompute across commerce modules.
 *
 * Per-product, all-time paid orders decide the winner; an admin "pin" overrides.
 * Two columns per plan table (see 2026-06-30_most_popular_plan_flags.sql):
 *   - most_popular_pinned : admin override. When any plan of a product is pinned,
 *                           the pinned plan wins (lowest price→id if several).
 *   - is_most_popular     : EFFECTIVE flag the API reads. Written here.
 *
 * Winner per product: pinned plan if any; else the plan with the most all-time
 * PAID orders; tie → lowest price, then lowest id. No sales + no pin → all false.
 *
 * Scopes (5 logical modules over 3 plan tables — course/package/ebook share one):
 *   course      : ws_package_course_ebook_price (courseId)  ← paid PackageCourseOrder
 *   package     : ws_package_course_ebook_price (packageId) ← paid PackageCourseOrder
 *   ebook       : ws_package_course_ebook_price (ebookId)   ← paid EBookOrder
 *   liveCourse  : ws_live_course_plan          (liveCourseId) ← verified LiveCourseSubscription
 *   testSeries  : ws_test_series_price          (testSeriesId) ← complete TestSeriesOrder
 */
import { prisma } from "../../config/prisma";

export type PopularityScope = "course" | "package" | "ebook" | "liveCourse" | "testSeries";
export const POPULARITY_SCOPES: PopularityScope[] = ["course", "package", "ebook", "liveCourse", "testSeries"];

// One plan as the ranker sees it. price coerced to number (test-series is Decimal).
interface PlanRow { id: number; productId: number; price: number; pinned: boolean }

// Pick the winning plan id for ONE product, or null (no pin + no sales).
function pickWinner(plans: PlanRow[], paidByPlan: Map<number, number>): number | null {
  if (plans.length === 0) return null;
  const pinned = plans.filter((p) => p.pinned);
  if (pinned.length) {
    return [...pinned].sort((a, b) => a.price - b.price || a.id - b.id)[0].id;
  }
  const withCount = plans.map((p) => ({ ...p, c: paidByPlan.get(p.id) ?? 0 }));
  const max = Math.max(...withCount.map((x) => x.c));
  if (max <= 0) return null; // no pin, no sales → no badge
  return withCount.filter((x) => x.c === max).sort((a, b) => a.price - b.price || a.id - b.id)[0].id;
}

// ── per-scope data access ──────────────────────────────────────────────────────
// Returns active plans (id, productId, price, pinned) for the scope, optionally
// for a single product, and a planId→paid-order-count map covering those plans.

async function loadCpe(field: "courseId" | "packageId" | "ebookId", productId?: number) {
  const where: any = { status: true, [field]: productId != null ? productId : { not: null } };
  const plans = await prisma.packageCourseEbookPrice.findMany({
    where, select: { id: true, price: true, mostPopularPinned: true, courseId: true, packageId: true, ebookId: true },
  });
  const rows: PlanRow[] = plans.map((p) => ({ id: p.id, productId: Number((p as any)[field]), price: p.price, pinned: p.mostPopularPinned }));
  return rows;
}

async function paidCountsCpe(orderModel: "packageCourseOrder" | "eBookOrder", planIds: number[]): Promise<Map<number, number>> {
  if (!planIds.length) return new Map();
  const grouped = await (prisma[orderModel] as any).groupBy({
    by: ["planId"], where: { planId: { in: planIds }, status: "complete" }, _count: { _all: true },
  });
  return new Map(grouped.map((g: any) => [g.planId as number, g._count._all as number]));
}

// ── recompute one scope (full sweep, or a single product) ───────────────────────
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
      select: { id: true, price: true, mostPopularPinned: true, liveCourseId: true },
    });
    plans = rows.map((p) => ({ id: p.id, productId: p.liveCourseId, price: p.price, pinned: p.mostPopularPinned }));
    const ids = plans.map((p) => p.id);
    if (ids.length) {
      const grouped = await prisma.liveCourseSubscription.groupBy({
        by: ["planId"], where: { planId: { in: ids }, paymentStatus: "verified" }, _count: { _all: true },
      });
      paid = new Map(grouped.map((g) => [g.planId as number, g._count._all]));
    }
  } else {
    // testSeries — price is Decimal; coerce to number for ranking.
    const rows = await prisma.testSeriesPrice.findMany({
      where: { status: true, ...(productId != null ? { testSeriesId: productId } : {}) },
      select: { id: true, price: true, mostPopularPinned: true, testSeriesId: true },
    });
    plans = rows.map((p) => ({ id: p.id, productId: p.testSeriesId, price: Number(p.price), pinned: p.mostPopularPinned }));
    const ids = plans.map((p) => p.id);
    if (ids.length) {
      const grouped = await prisma.testSeriesOrder.groupBy({
        by: ["planId"], where: { planId: { in: ids }, status: "complete" }, _count: { _all: true },
      });
      paid = new Map(grouped.map((g) => [g.planId as number, g._count._all]));
    }
  }

  // Group plans by product, pick a winner per product, collect the desired flag.
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
  // Re-read current flags for just these plans to diff.
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

/** Recompute every scope (the scheduled-job entry point). Returns per-scope change counts. */
export async function recomputeAllPopularity(): Promise<Record<PopularityScope, number>> {
  const out = {} as Record<PopularityScope, number>;
  for (const scope of POPULARITY_SCOPES) out[scope] = await recomputeScope(scope);
  return out;
}

// The (model, productId-field) for a scope's plan table.
function scopeTable(scope: PopularityScope): { model: any; productField: string } {
  if (scope === "liveCourse") return { model: prisma.liveCoursePlan, productField: "liveCourseId" };
  if (scope === "testSeries") return { model: prisma.testSeriesPrice, productField: "testSeriesId" };
  // course/package/ebook share the price table; productField differs by scope.
  const productField = scope === "course" ? "courseId" : scope === "package" ? "packageId" : "ebookId";
  return { model: prisma.packageCourseEbookPrice, productField };
}

/**
 * Admin override: pin/unpin a plan as "most popular". Sets most_popular_pinned on
 * the plan, then immediately recomputes the WHOLE product so the effective
 * is_most_popular flag reflects the change at once (pin wins; unpin → falls back to
 * the most-purchased plan). Returns "not_found" if the plan isn't in the scope.
 */
export async function setPinned(scope: PopularityScope, planId: number, pinned: boolean): Promise<"ok" | "not_found"> {
  const { model, productField } = scopeTable(scope);
  const plan = await model.findFirst({ where: { id: planId, ...(scope === "course" || scope === "package" || scope === "ebook" ? { [productField]: { not: null } } : {}) }, select: { id: true, [productField]: true } });
  if (!plan) return "not_found";
  await model.update({ where: { id: planId }, data: { mostPopularPinned: pinned } });
  const productId = Number((plan as any)[productField]);
  if (productId > 0) await recomputeScope(scope, productId);
  return "ok";
}
