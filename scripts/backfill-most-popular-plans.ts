/*
 * Backfill / recompute the "Most Popular" pricing-plan flag across all commerce
 * scopes (course/package/ebook/liveCourse/testSeries). Idempotent: writes only
 * rows whose flag changes. Run after applying 2026-06-30_most_popular_plan_flags.sql.
 *
 *   npx tsx scripts/backfill-most-popular-plans.ts
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { recomputeAllPopularity } from "../src/modules/plan-popularity/plan-popularity.service";

(async () => {
  const res = await recomputeAllPopularity();
  console.log("Most-popular recompute — rows changed per scope:");
  for (const [scope, n] of Object.entries(res)) console.log(`  ${scope.padEnd(12)} ${n}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error("FATAL", e?.message ?? e); await prisma.$disconnect(); process.exit(1); });
