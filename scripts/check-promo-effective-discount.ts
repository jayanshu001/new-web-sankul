/**
 * Read-only check: client promocode list resolves the per-entity effective
 * discount from ws_promoted_package_course_ebook, keyed on (planId, planKind).
 * Usage: npx tsx scripts/check-promo-effective-discount.ts <promocodeId> <type> <entityId>
 * e.g.   npx tsx scripts/check-promo-effective-discount.ts 5 testSeries 1
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../src/config/prisma";
import { resolveEffectiveDiscounts, normalizeAppliesToType } from "../src/modules/promo-code/promo-code.service";

(async () => {
  const [idArg, typeArg, entityArg] = process.argv.slice(2);
  const id = Number(idArg);
  const type = normalizeAppliesToType(typeArg ?? "");
  const entityId = Number(entityArg);
  assert(Number.isInteger(id) && type && Number.isInteger(entityId), "args: <promocodeId> <type> <entityId>");

  const row = await prisma.promocode.findUnique({ where: { id } });
  assert(row, `promocode ${id} not found`);
  const links = await prisma.promotedPackageCourseEbook.findMany({ where: { promocodeId: id } });
  console.log("column:", row.discountType, Number(row.discountValue ?? 0));
  console.log("links :", links.map((l) => `${l.planKind}#${l.planId} ${l.type ?? "?"} cust=${l.customerPercentage}%`).join(" | ") || "(none)");

  const scoped = await resolveEffectiveDiscounts([row], { type, id: entityId });
  const eff = scoped.get(id);
  console.log(`effective for ${type}:${entityId} →`, eff ?? "(unset → column fallback)");

  // Invariant: any link of the wanted kind, on an ACTIVE plan of this entity,
  // with pct>0 must surface as effective.discountValue >= that pct.
  const kindByType: Record<string, string> = { package: "price", course: "price", ebook: "price", liveCourse: "livePlan", testSeries: "testSeriesPrice" };
  const inScope = links.filter((l) => l.planKind === kindByType[type] && Number(l.customerPercentage) > 0);
  if (inScope.length && eff) assert(eff.discountValue >= Math.max(...inScope.map((l) => Number(l.customerPercentage))) || eff.discountValue === 0, "in-scope link pct not surfaced");
  await prisma.$disconnect();
})();
