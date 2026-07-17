/**
 * Strip legacy ANCESTOR rows from ws_exam_category_pivot.
 *
 * The pivot now records only the categories an admin actually filed an exam under
 * (always leaves — the picker offers nothing else). The previous write path also
 * wrote each category's ancestors into the same table as a denormalized rollup, so
 * rows written before that change are indistinguishable from a real selection at
 * read time: GET /admin/quizzes would render an ancestor as a category chip, and the
 * edit modal would prefill a category the picker greys out and cannot re-select.
 *
 * Any pivot row whose category has active children is such an artifact. Parent
 * lookups no longer need these rows — read paths expand the tree themselves (see
 * descendantExamCategoryIds).
 *
 * Rows are only deleted where the exam retains at least one leaf row: an exam filed
 * directly on a non-leaf category (legacy data the current write path forbids) is
 * REPORTED and skipped rather than left with zero categories.
 *
 *   npx tsx scripts/cleanup-exam-category-pivot-ancestors.ts            # dry run
 *   npx tsx scripts/cleanup-exam-category-pivot-ancestors.ts --apply    # delete
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const run = async () => {
  const [{ total }] = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
    `SELECT COUNT(*) AS total FROM ws_exam_category_pivot`
  );
  console.log(`Pivot rows: ${total}`);

  // Rows whose category still has active children → written by the old rollup.
  const artifacts = await prisma.$queryRawUnsafe<{ id: bigint; exam_id: number; category_id: number }[]>(
    `SELECT p.id, p.exam_id, p.category_id
       FROM ws_exam_category_pivot p
      WHERE EXISTS (SELECT 1 FROM ws_exam_category ch
                     WHERE ch.parent_id = p.category_id AND ch.deleted = 0)`
  );
  console.log(`Ancestor (non-leaf) rows: ${artifacts.length}`);
  if (!artifacts.length) return console.log("Nothing to clean.");

  // Exams that would be left with no categories at all — skip, don't orphan.
  const stranded = await prisma.$queryRawUnsafe<{ exam_id: number }[]>(
    `SELECT p.exam_id FROM ws_exam_category_pivot p
      GROUP BY p.exam_id
     HAVING SUM(NOT EXISTS (SELECT 1 FROM ws_exam_category ch
                             WHERE ch.parent_id = p.category_id AND ch.deleted = 0)) = 0`
  );
  const skip = new Set(stranded.map((r) => Number(r.exam_id)));
  if (skip.size) {
    console.warn(
      `\n⚠ ${skip.size} exam(s) are filed ONLY on non-leaf categories and would be left ` +
        `with zero categories. Skipping them; they need a category assigned by hand ` +
        `(they cannot be saved from the edit modal until then):\n  ${[...skip].join(", ")}\n`
    );
  }

  const deletable = artifacts.filter((r) => !skip.has(Number(r.exam_id)));
  console.log(`Deletable: ${deletable.length} (skipped ${artifacts.length - deletable.length})`);
  for (const r of deletable.slice(0, 20))
    console.log(`  exam ${r.exam_id} → drop category ${r.category_id}`);
  if (deletable.length > 20) console.log(`  … +${deletable.length - 20} more`);

  if (!APPLY) return console.log("\nDry run. Re-run with --apply to delete.");

  const ids = deletable.map((r) => r.id);
  let done = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const res = await prisma.examCategoryPivot.deleteMany({ where: { id: { in: batch } } });
    done += res.count;
    console.log(`  deleted ${done}/${ids.length}`);
  }
  console.log(`Done. Removed ${done} ancestor rows.`);
};

run()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
