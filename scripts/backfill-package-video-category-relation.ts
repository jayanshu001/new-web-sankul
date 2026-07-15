/**
 * Backfill ws_video_category_package_relation from the current video-category DAG.
 *
 * The SQL package-save flow never populated this denormalized table (only deletePackage
 * cleaned it), so its rows are stale/absent for packages created or edited on MySQL.
 * This rebuilds every package's rows as the DOWNWARD DAG closure of its active
 * specific-subjects (ws_package_specific_subject) — the same rule the runtime sync now
 * maintains on package save + video-category DAG mutations (see package-relation-sync.ts).
 *
 * Safe to re-run (idempotent — it fully replaces the table's contents).
 *
 *   npx tsx scripts/backfill-package-video-category-relation.ts
 */
import { prisma } from "../src/config/prisma";
import { rebuildAllPackageRelations } from "../src/modules/admin-package/package-relation-sync";

async function main() {
  const before = await prisma.packageVideoCategoryRelation.count();
  // ATOMIC: clears + rebuilds in one transaction — a failure rolls back and leaves the
  // existing rows intact (fail-loud, unlike the runtime best-effort sync).
  await rebuildAllPackageRelations();
  const after = await prisma.packageVideoCategoryRelation.count();
  const pkgs = await prisma.packageVideoCategoryRelation.findMany({ select: { packageId: true }, distinct: ["packageId"] });
  console.log(`ws_video_category_package_relation rebuilt: ${before} → ${after} rows across ${pkgs.length} packages.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
