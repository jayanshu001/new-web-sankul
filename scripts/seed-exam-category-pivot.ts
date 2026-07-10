/**
 * Seeder — load ws_exam_category_pivot rows from the production SQL export,
 * or build demo rows for local/staging DBs (few exams, no prod dump).
 *
 * Prerequisites:
 *   1. yarn db:migrate   (creates empty ws_exam_category_pivot)
 *   2. yarn prisma:generate
 *
 * Usage:
 *   yarn seed:exam-category-pivot              # from old_db/ws_exam_category_pivot.sql
 *   yarn seed:exam-category-pivot:demo         # local/staging — uses exams already in DB
 *
 * Demo mode builds pivot links from each ws_exam row:
 *   - primary category = exam.exam_category_id (or fallback if missing)
 *   - ancestor categories walked via parent_id (mimics prod parent links)
 *   - optional extra root category for multi-category testing
 *
 * Env (all optional):
 *   SEED_EXAM_CATEGORY_PIVOT_MODE            sql | demo (default: sql; --demo sets demo)
 *   SEED_EXAM_CATEGORY_PIVOT_FILE            SQL dump path (sql mode)
 *   SEED_EXAM_CATEGORY_PIVOT_SKIP_ORPHANS    sql mode FK filter (default: true)
 *   SEED_EXAM_CATEGORY_PIVOT_DRY_RUN         parse/build only, no writes
 *   SEED_EXAM_CATEGORY_PIVOT_TRUNCATE        TRUNCATE before insert (dev)
 *   SEED_EXAM_CATEGORY_PIVOT_BATCH_SIZE      batch size (default: 500)
 *   SEED_EXAM_CATEGORY_PIVOT_DEMO_CATEGORY_ID fallback leaf category (default: 6)
 *   SEED_EXAM_CATEGORY_PIVOT_DEMO_EXTRA_ROOT  extra root link per exam (default: 12; 0=off)
 */
import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const envBool = (key: string, defaultValue: boolean): boolean => {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
};

const envInt = (key: string, defaultValue: number): number => {
  const n = Number(process.env[key]);
  return Number.isInteger(n) && n > 0 ? n : defaultValue;
};

const envIntOrZero = (key: string, defaultValue: number): number => {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : defaultValue;
};

export type PivotSeedRow = {
  examId: number;
  categoryId: number;
  created_at: Date | null;
  updated_at: Date | null;
};

/** Parse INSERT tuples from phpMyAdmin export: (id, exam_id, category_id, 'ts', 'ts') */
export const parsePivotSql = (content: string): PivotSeedRow[] => {
  const re = /\(\d+,\s*(\d+),\s*(\d+),\s*'([^']*)',\s*'([^']*)'\)/g;
  const rows: PivotSeedRow[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    const examId = Number(m[1]);
    const categoryId = Number(m[2]);
    if (!Number.isInteger(examId) || !Number.isInteger(categoryId)) continue;
    const key = `${examId}:${categoryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      examId,
      categoryId,
      created_at: m[3] ? new Date(m[3].replace(" ", "T") + "Z") : null,
      updated_at: m[4] ? new Date(m[4].replace(" ", "T") + "Z") : null,
    });
  }

  return rows;
};

/** Category id + ancestors up to root (inclusive). */
export const categoryAncestorIds = (
  categoryId: number,
  catById: Map<number, { parent: number }>
): number[] => {
  const ids: number[] = [];
  const guard = new Set<number>();
  let cur: number | null = categoryId;
  while (cur != null && catById.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    ids.push(cur);
    const parent = catById.get(cur)!.parent;
    cur = parent && parent !== 0 ? parent : null;
  }
  return ids;
};

/**
 * Demo pivot rows for local DBs: link each exam to its category tree (+ optional extra root).
 * Staging exam 300001 references category 1637 which is absent from the dump — falls back to cat 6.
 */
export const buildDemoPivotRows = async (prisma: PrismaClient): Promise<PivotSeedRow[]> => {
  const now = new Date();
  const fallbackCatId = envInt("SEED_EXAM_CATEGORY_PIVOT_DEMO_CATEGORY_ID", 6);
  const extraRoot = envIntOrZero("SEED_EXAM_CATEGORY_PIVOT_DEMO_EXTRA_ROOT", 12);

  const [exams, categories] = await Promise.all([
    prisma.exam.findMany({ select: { id: true, examCategoryId: true } }),
    prisma.examCategory.findMany({ select: { id: true, parent: true } }),
  ]);

  if (exams.length === 0) {
    console.warn("No ws_exam rows — nothing to seed in demo mode.");
    return [];
  }
  if (categories.length === 0) {
    console.warn("No ws_exam_category rows — cannot build demo pivot.");
    return [];
  }

  const catById = new Map(categories.map((c) => [c.id, c]));
  const defaultLeaf =
    (catById.has(fallbackCatId) ? fallbackCatId : null) ?? categories[0]!.id;

  const rows: PivotSeedRow[] = [];
  const seen = new Set<string>();
  const add = (examId: number, categoryId: number) => {
    if (!catById.has(categoryId)) return;
    const key = `${examId}:${categoryId}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ examId, categoryId, created_at: now, updated_at: now });
  };

  for (const exam of exams) {
    let leaf = exam.examCategoryId;
    if (leaf == null || !catById.has(leaf)) {
      console.warn(
        `Exam ${exam.id}: exam_category_id ${exam.examCategoryId ?? "null"} missing locally — ` +
          `using category ${defaultLeaf} for demo pivot.`
      );
      leaf = defaultLeaf;
    }
    for (const catId of categoryAncestorIds(leaf, catById)) add(exam.id, catId);
    if (extraRoot > 0) add(exam.id, extraRoot);
  }

  return rows;
};

const ensurePivotTable = async (prisma: PrismaClient): Promise<void> => {
  const tableCheck = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'ws_exam_category_pivot'`
  );
  if (Number(tableCheck[0]?.cnt ?? 0) === 0) {
    console.error("Table ws_exam_category_pivot does not exist. Run: yarn db:migrate");
    process.exit(1);
  }
};

const insertRows = async (
  prisma: PrismaClient,
  toInsert: PivotSeedRow[],
  opts: { dryRun: boolean; truncate: boolean; batchSize: number }
): Promise<void> => {
  const existing = await prisma.examCategoryPivot.count();
  console.log(`Current pivot row count: ${existing}`);

  if (toInsert.length === 0) {
    console.log("Nothing to insert.");
    return;
  }

  if (opts.dryRun) {
    console.log("DRY RUN — no writes.");
    console.log(`Would insert up to ${toInsert.length} row(s):`);
    for (const r of toInsert.slice(0, 10)) {
      console.log(`  exam ${r.examId} ↔ category ${r.categoryId}`);
    }
    if (toInsert.length > 10) console.log(`  ... and ${toInsert.length - 10} more`);
    return;
  }

  if (opts.truncate) {
    console.warn("TRUNCATE ws_exam_category_pivot ...");
    await prisma.$executeRawUnsafe("TRUNCATE TABLE `ws_exam_category_pivot`");
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += opts.batchSize) {
    const batch = toInsert.slice(i, i + opts.batchSize);
    const result = await prisma.examCategoryPivot.createMany({
      data: batch.map((r) => ({
        examId: r.examId,
        categoryId: r.categoryId,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      skipDuplicates: true,
    });
    inserted += result.count;
    process.stdout.write(`  batch ${Math.floor(i / opts.batchSize) + 1}: +${result.count}\n`);
  }

  const finalCount = await prisma.examCategoryPivot.count();
  console.log("\nExam category pivot seeded:");
  console.log(`  inserted (this run) : ${inserted}`);
  console.log(`  total rows in table : ${finalCount}`);
};

const runSqlMode = async (prisma: PrismaClient): Promise<void> => {
  const sqlPath = path.resolve(
    __dirname,
    "..",
    process.env.SEED_EXAM_CATEGORY_PIVOT_FILE ?? "old_db/ws_exam_category_pivot.sql"
  );
  const skipOrphans = envBool("SEED_EXAM_CATEGORY_PIVOT_SKIP_ORPHANS", true);
  const dryRun = envBool("SEED_EXAM_CATEGORY_PIVOT_DRY_RUN", false);
  const truncate = envBool("SEED_EXAM_CATEGORY_PIVOT_TRUNCATE", false);
  const batchSize = envInt("SEED_EXAM_CATEGORY_PIVOT_BATCH_SIZE", 500);

  if (!existsSync(sqlPath)) {
    console.error(`SQL file not found: ${sqlPath}`);
    process.exit(1);
  }

  console.log(`Reading ${sqlPath} ...`);
  const parsed = parsePivotSql(readFileSync(sqlPath, "utf8"));
  console.log(`Parsed ${parsed.length} unique (exam_id, category_id) row(s) from SQL.`);

  if (parsed.length === 0) {
    console.error("No rows parsed — check the SQL file format.");
    process.exit(1);
  }

  let toInsert = parsed;

  if (skipOrphans) {
    const [exams, categories] = await Promise.all([
      prisma.exam.findMany({ select: { id: true } }),
      prisma.examCategory.findMany({ select: { id: true } }),
    ]);
    const examIds = new Set(exams.map((r) => r.id));
    const categoryIds = new Set(categories.map((r) => r.id));

    const before = toInsert.length;
    toInsert = toInsert.filter((r) => examIds.has(r.examId) && categoryIds.has(r.categoryId));
    const skipped = before - toInsert.length;
    console.log(
      `FK filter: ${toInsert.length} row(s) kept, ${skipped} orphan(s) skipped ` +
        `(${examIds.size} exams, ${categoryIds.size} categories in DB).`
    );
    if (skipped > 0 && toInsert.length === 0) {
      console.warn(
        "All rows were orphans — use yarn seed:exam-category-pivot:demo for local/staging, " +
          "or import production ws_exam data first."
      );
    }
  }

  await insertRows(prisma, toInsert, { dryRun, truncate, batchSize });
};

const runDemoMode = async (prisma: PrismaClient): Promise<void> => {
  const dryRun = envBool("SEED_EXAM_CATEGORY_PIVOT_DRY_RUN", false);
  const truncate = envBool("SEED_EXAM_CATEGORY_PIVOT_TRUNCATE", false);
  const batchSize = envInt("SEED_EXAM_CATEGORY_PIVOT_BATCH_SIZE", 500);

  console.log("Demo mode — building pivot rows from ws_exam + ws_exam_category in DB ...");
  const toInsert = await buildDemoPivotRows(prisma);
  console.log(`Built ${toInsert.length} demo pivot row(s).`);
  await insertRows(prisma, toInsert, { dryRun, truncate, batchSize });
};

const main = async () => {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Missing DATABASE_URL. Set it in .env before seeding.");
    process.exit(1);
  }

  const demoArgv = process.argv.includes("--demo");
  const mode =
    process.env.SEED_EXAM_CATEGORY_PIVOT_MODE?.toLowerCase() === "demo" || demoArgv
      ? "demo"
      : "sql";

  const { prisma, disconnectPrisma } = await import("../src/config/prisma.ts");

  try {
    await ensurePivotTable(prisma);
    if (mode === "demo") await runDemoMode(prisma);
    else await runSqlMode(prisma);
  } catch (err) {
    console.error("Seeding failed:", err);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
};

main();
