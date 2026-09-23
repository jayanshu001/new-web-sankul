/**
 * Backfill NULL `ws_material_category_package.created_at` / `updated_at`.
 *
 * Sibling of `backfill-exam-category-package-timestamps.ts` — the two pivots are
 * structurally identical (package_id + category_id + order + timestamps), written
 * by adjacent code in the same repository, and have the same legacy gap. See that
 * script's header for the full reasoning; the short version:
 *
 * TABLE IS ACTIVELY USED — the Package ↔ MaterialCategory pivot. Writes at
 * `admin-package.repository.ts:108/110/125/140/198`; reads across the admin
 * package screen and client catalog.
 *
 * WHY NULL: the columns are mapped on the model and the central timestamp
 * middleware DOES fill them — verified 2026-07-25 by writing through the real
 * `createMany`-inside-`$transaction` shape (probe got both). But the middleware
 * only landed 2026-07-16 (commit de0233e), and every surviving pivot row predates
 * it. The FORWARD path needs no fix; this repairs history only.
 *
 * SOURCE: the parent `ws_package.updated_at` — the write path REPLACES pivots
 * (deleteMany + createMany), so rows were last recreated when the package was last
 * edited. Clamped to the middleware cutover (a row written after it would already
 * carry timestamps, so a later parent `updated_at` provably overshoots), and
 * floored at the package's `created_at`.
 *
 * ⚠ `created_at` here means "when this pivot row was last written", NOT "when the
 *   link was first made" — the delete-then-recreate path resets it on every edit
 *   that includes material categories. True of live rows too.
 *
 * `model Package` does not map its own created_at/updated_at, so they are read via
 * $queryRawUnsafe. Verified that $queryRaw RESULTS still pass through the IST read
 * shift, so those Dates share the same UTC app-space as Prisma reads and can be
 * written back through Prisma without double-shifting.
 *
 * Idempotent: only touches rows where created_at IS NULL OR updated_at IS NULL.
 *
 *   npx tsx scripts/backfill-material-category-package-timestamps.ts          # dry run
 *   npx tsx scripts/backfill-material-category-package-timestamps.ts --apply  # write
 */
import { prisma } from "../src/config/prisma";

const APPLY = process.argv.includes("--apply");

/** Timestamp middleware went live 2026-07-16 (commit de0233e). */
const MIDDLEWARE_CUTOVER = new Date("2026-07-16T00:00:00.000Z");

async function main() {
  const targets = await prisma.materialCategoryPackage.findMany({
    where: { OR: [{ created_at: null }, { updated_at: null }] },
    select: { id: true, packageId: true, created_at: true, updated_at: true },
    orderBy: { id: "asc" },
  });

  if (!targets.length) {
    console.log("Nothing to do — every ws_material_category_package row has timestamps.");
    return;
  }

  const pkgIds = [...new Set(targets.map((t) => t.packageId).filter((v): v is number => v != null))];
  const pkgRows = pkgIds.length
    ? await prisma.$queryRawUnsafe<{ id: number; created_at: Date | null; updated_at: Date | null }[]>(
        `SELECT id, created_at, updated_at FROM ws_package WHERE id IN (${pkgIds.map(() => "?").join(",")})`,
        ...pkgIds
      )
    : [];
  const pkgById = new Map(pkgRows.map((p) => [p.id, { createdAt: p.created_at, updatedAt: p.updated_at }]));

  console.log(`${targets.length} pivot row(s) missing timestamps${APPLY ? "" : "  (DRY RUN — pass --apply to write)"}\n`);

  const perPackage = new Map<string, number>();
  let resolved = 0;
  let skipped = 0;

  for (const t of targets) {
    const pkg = t.packageId != null ? pkgById.get(t.packageId) : undefined;
    if (!pkg?.updatedAt && !pkg?.createdAt) {
      skipped++;
      continue;
    }

    let stamp = pkg.updatedAt ?? pkg.createdAt!;
    if (stamp > MIDDLEWARE_CUTOVER) stamp = MIDDLEWARE_CUTOVER;
    if (pkg.createdAt && stamp < pkg.createdAt) stamp = pkg.createdAt;

    const key = `package ${t.packageId} -> ${stamp.toISOString()}`;
    perPackage.set(key, (perPackage.get(key) ?? 0) + 1);
    resolved++;

    if (APPLY) {
      await prisma.materialCategoryPackage.update({
        where: { id: t.id },
        data: { created_at: t.created_at ?? stamp, updated_at: t.updated_at ?? stamp },
      });
    }
  }

  for (const [k, n] of [...perPackage.entries()].sort()) console.log(`  ${k}   (${n} row${n === 1 ? "" : "s"})`);
  console.log(`\n${APPLY ? "Backfilled" : "Would backfill"} ${resolved} row(s)${skipped ? `, ${skipped} skipped (parent package missing/undated)` : ""}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("Backfill failed:", e); process.exit(1); });
