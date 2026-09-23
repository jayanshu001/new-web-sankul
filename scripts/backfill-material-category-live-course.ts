/*
 * Backfill ws_material_category_live_course from ws_live_course.material_categories.
 *
 * Live courses attached material categories only in the JSON column, which the
 * client-material entitlement join cannot read — so live-course buyers saw
 * isPurchased:false (and mediaToken:null) on every study material. The pivot
 * added 2026-07-31 fixes the join; this script populates it for existing rows.
 *
 * Idempotent: the pivot is UNIQUE(live_course_id, mcategory_id) and only missing
 * edges are inserted. Rows whose category no longer exists in
 * ws_material_category are skipped and reported (a dangling JSON ref would
 * unlock nothing anyway).
 *
 * Run AFTER applying docs/migration/schema-changes/2026-07-31_material_category_live_course.sql
 * and `yarn prisma:generate` + restart.
 *
 *   npx tsx scripts/backfill-material-category-live-course.ts --dry
 *   npx tsx scripts/backfill-material-category-live-course.ts
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { parseMaterialCategoryRefs } from "../src/modules/admin-live-course/admin-live-course.refs";

const DRY = process.argv.includes("--dry");

(async () => {
  const [courses, existing, categories] = await Promise.all([
    prisma.liveCourse.findMany({ select: { id: true, name: true, materialCategories: true } }),
    prisma.materialCategoryLiveCourse.findMany({ select: { liveCourseId: true, materialCategoryId: true } }),
    prisma.materialCategory.findMany({ select: { id: true } }),
  ]);

  const edgeKey = (liveCourseId: number, categoryId: number) => `${liveCourseId}:${categoryId}`;
  const have = new Set(existing.map((e) => edgeKey(e.liveCourseId, e.materialCategoryId)));
  const knownCategories = new Set(categories.map((c) => c.id));

  const toInsert: Array<{ liveCourseId: number; materialCategoryId: number; order: number }> = [];
  const dangling: Array<{ liveCourseId: number; name: string; categoryId: number }> = [];
  let coursesWithRefs = 0;
  let refsSeen = 0;

  for (const c of courses) {
    const refs = parseMaterialCategoryRefs(c.materialCategories);
    if (!refs.length) continue;
    coursesWithRefs += 1;
    refsSeen += refs.length;
    for (const r of refs) {
      if (!knownCategories.has(r.categoryId)) {
        dangling.push({ liveCourseId: c.id, name: c.name, categoryId: r.categoryId });
        continue;
      }
      if (have.has(edgeKey(c.id, r.categoryId))) continue;
      have.add(edgeKey(c.id, r.categoryId));
      toInsert.push({ liveCourseId: c.id, materialCategoryId: r.categoryId, order: r.order });
    }
  }

  console.log(`Live courses total .............. ${courses.length}`);
  console.log(`  with material category refs ... ${coursesWithRefs}`);
  console.log(`JSON refs seen .................. ${refsSeen}`);
  console.log(`Pivot rows already present ...... ${existing.length}`);
  console.log(`Missing pivot rows (to insert) .. ${toInsert.length}`);
  if (dangling.length) {
    console.log(`Dangling refs (category gone) ... ${dangling.length}  (skipped)`);
    for (const d of dangling.slice(0, 20)) console.log(`  live course ${d.liveCourseId} "${d.name}" → category ${d.categoryId}`);
    if (dangling.length > 20) console.log(`  ...and ${dangling.length - 20} more`);
  }

  if (!toInsert.length) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  if (DRY) {
    console.log("(dry run — nothing written)");
    for (const r of toInsert.slice(0, 20)) console.log(`  would insert (live course ${r.liveCourseId} -> category ${r.materialCategoryId}, order ${r.order})`);
    if (toInsert.length > 20) console.log(`  ...and ${toInsert.length - 20} more`);
    await prisma.$disconnect();
    return;
  }

  const now = new Date();
  const inserted = await prisma.materialCategoryLiveCourse.createMany({
    data: toInsert.map((r) => ({ ...r, created_at: now, updated_at: now })),
    skipDuplicates: true,
  });
  console.log(`Inserted pivot rows ............. ${inserted.count}`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("FATAL", e?.message ?? e);
  await prisma.$disconnect();
  process.exit(1);
});
