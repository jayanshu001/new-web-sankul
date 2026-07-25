/**
 * Backfill NULL `ws_exam_category_package.created_at` / `updated_at`.
 *
 * THE TABLE IS ACTIVELY USED — audited 2026-07-25, 12 call sites, read + write:
 *   reads  — client-free.service.ts:77, catalog-exam.repository.ts:114,
 *            catalog-package.detail.sql.ts:80, client-catalog.service.ts:414,
 *            admin-package.repository.ts:61/74/76
 *   writes — admin-package.repository.ts:113/115/126/142/200
 * It is the Package ↔ ExamCategory pivot (with a per-package display `order`).
 * Not a removal candidate.
 *
 * WHY THE TIMESTAMPS WERE NULL: the columns are mapped in Prisma, and the central
 * timestamp middleware (src/config/prisma.ts) DOES handle `createMany` correctly —
 * verified 2026-07-25 by writing through the real path. But the middleware only
 * landed 2026-07-16 (commit de0233e, the IST migration), and every surviving pivot
 * row was written before that. So the FORWARD path needs no fix; this only repairs
 * history.
 *
 * SOURCE (best-effort — a pivot row carries no timestamp of its own):
 *   the parent `ws_package.updated_at`, because the write path REPLACES pivots
 *   (deleteMany + createMany), so the rows were last recreated when the package
 *   was last edited. Clamped to the middleware cutover: a pivot written after the
 *   cutover would already have timestamps, so any parent `updated_at` later than
 *   the cutover provably overshoots (e.g. package 990093 was updated 2026-07-21
 *   without touching its exam categories — the pivot replace at
 *   admin-package.repository.ts:113 is conditional on `examCategories` being in
 *   the payload). Floored at the package's `created_at`.
 *
 * ⚠ `created_at` on this table is NOT "when this link was first made" — the
 *   delete-then-recreate write path resets it on every edit that includes exam
 *   categories. It means "when this pivot row was last written". That is true of
 *   live rows too, not just backfilled ones.
 *
 * All timestamps flow through Prisma so the IST read/write shift round-trips — do
 * NOT rewrite this with raw SQL, which bypasses the shift.
 *
 * Idempotent: only touches rows where created_at IS NULL OR updated_at IS NULL.
 *
 *   npx tsx scripts/backfill-exam-category-package-timestamps.ts          # dry run
 *   npx tsx scripts/backfill-exam-category-package-timestamps.ts --apply  # write
 */
import { prisma } from "../src/config/prisma";

const APPLY = process.argv.includes("--apply");

/** Timestamp middleware went live 2026-07-16 (commit de0233e). */
const MIDDLEWARE_CUTOVER = new Date("2026-07-16T00:00:00.000Z");

async function main() {
  const targets = await prisma.examCategoryPackage.findMany({
    where: { OR: [{ created_at: null }, { updated_at: null }] },
    select: { id: true, packageId: true, created_at: true, updated_at: true },
    orderBy: { id: "asc" },
  });

  if (!targets.length) {
    console.log("Nothing to do — every ws_exam_category_package row has timestamps.");
    return;
  }

  const pkgIds = [...new Set(targets.map((t) => t.packageId).filter((v): v is number => v != null))];

  // `model Package` does not map created_at/updated_at (the columns exist in
  // MySQL but were never added to the Prisma model), so they must be read raw.
  // Verified 2026-07-25: $queryRaw RESULTS still pass through the IST read shift
  // (ws_package.id=3 reads 18:19:44 IST as 12:49:44Z), so these Dates are in the
  // same UTC app-space as everything else and can be written back through Prisma
  // without double-shifting.
  const pkgRows = pkgIds.length
    ? await prisma.$queryRawUnsafe<{ id: number; created_at: Date | null; updated_at: Date | null }[]>(
        `SELECT id, created_at, updated_at FROM ws_package WHERE id IN (${pkgIds.map(() => "?").join(",")})`,
        ...pkgIds
      )
    : [];
  const pkgById = new Map(
    pkgRows.map((p) => [p.id, { createdAt: p.created_at, updatedAt: p.updated_at }])
  );

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

    // Clamp to the cutover (the row provably predates it), then floor at the
    // package's own creation so we never claim a pivot predates its parent.
    let stamp = pkg.updatedAt ?? pkg.createdAt!;
    if (stamp > MIDDLEWARE_CUTOVER) stamp = MIDDLEWARE_CUTOVER;
    if (pkg.createdAt && stamp < pkg.createdAt) stamp = pkg.createdAt;

    const key = `package ${t.packageId} -> ${stamp.toISOString()}`;
    perPackage.set(key, (perPackage.get(key) ?? 0) + 1);
    resolved++;

    if (APPLY) {
      await prisma.examCategoryPackage.update({
        where: { id: t.id },
        // Both passed explicitly so the middleware does not substitute `now`.
        data: { created_at: t.created_at ?? stamp, updated_at: t.updated_at ?? stamp },
      });
    }
  }

  for (const [k, n] of [...perPackage.entries()].sort()) console.log(`  ${k}   (${n} row${n === 1 ? "" : "s"})`);
  console.log(`\n${APPLY ? "Backfilled" : "Would backfill"} ${resolved} row(s)${skipped ? `, ${skipped} skipped (parent package missing/undated)` : ""}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("Backfill failed:", e); process.exit(1); });
