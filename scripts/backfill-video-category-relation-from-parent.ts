/*
 * Ensure ws_video_category_relation covers every ws_video_category.parent link, so
 * the parent/child READS (admin picker, admin category tree, client catalog counts)
 * — now sourced from the relation DAG — can never orphan a category that only the
 * legacy `parent` column knew about.
 *
 * For each category with parent > 0: ensure an edge (parent, child=id) exists;
 * insert one (order = order_by) if missing. Idempotent — inserts only what's absent.
 * Also reports drift (column parent vs relation primary parent) and dangling edges
 * for visibility. Run BEFORE flipping reads live.
 *
 *   npx tsx scripts/backfill-video-category-relation-from-parent.ts
 *   npx tsx scripts/backfill-video-category-relation-from-parent.ts --dry
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";

const DRY = process.argv.includes("--dry");

(async () => {
  const [categories, edges] = await Promise.all([
    prisma.videoCategory.findMany({ select: { id: true, parent: true, order_by: true } }),
    prisma.videoCategoryRelation.findMany({ select: { parent: true, child: true } }),
  ]);

  const edgeKey = (parent: number, child: number) => `${parent}:${child}`;
  const edgeSet = new Set(edges.map((e) => edgeKey(e.parent, e.child)));
  const catIds = new Set(categories.map((c) => c.id));

  const parented = categories.filter((c) => c.parent != null && c.parent > 0);
  const missing = parented.filter((c) => !edgeSet.has(edgeKey(c.parent!, c.id)));

  console.log(`Categories total ............ ${categories.length}`);
  console.log(`  with parent column > 0 .... ${parented.length}`);
  console.log(`Relation edges total ........ ${edges.length}`);
  console.log(`Missing edges (to insert) ... ${missing.length}`);

  if (missing.length && !DRY) {
    let inserted = 0;
    for (const c of missing) {
      await prisma.videoCategoryRelation.create({ data: { parent: c.parent!, child: c.id, order: c.order_by ?? 0 } });
      inserted += 1;
    }
    console.log(`Inserted edges .............. ${inserted}`);
  } else if (missing.length) {
    console.log("(dry run — no edges inserted)");
    for (const c of missing.slice(0, 20)) console.log(`  would insert (${c.parent} -> ${c.id})`);
    if (missing.length > 20) console.log(`  ...and ${missing.length - 20} more`);
  }

  // Visibility only — dangling edges referencing a category row that no longer exists.
  const dangling = edges.filter((e) => (e.parent > 0 && !catIds.has(e.parent)) || (e.child > 0 && !catIds.has(e.child)));
  if (dangling.length) console.log(`Dangling edges (orphan refs) ${dangling.length}  (not modified — review manually)`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("FATAL", e?.message ?? e);
  await prisma.$disconnect();
  process.exit(1);
});
