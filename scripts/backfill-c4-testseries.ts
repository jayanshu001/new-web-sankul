/*
 * Backfill Mongo test-series content-categories + exam links → SQL (C4):
 *   ws_test_series_content_category (NEW)  ← Mongo TestSeriesContentCategory
 *   ws_test_series_exam             (NEW)  ← Mongo TestSeriesExam
 *
 * NATURAL-KEY joins (no stored Mongo→SQL id map; datasets largely disjoint in
 * staging): TestSeries by `title`, Exam by `title`. Content-category ids are
 * minted fresh and mapped Mongo _id → new SQL id within this run. Rows whose
 * series/exam don't resolve are SKIPPED. Idempotent: the two NET-NEW tables are
 * cleared first (they hold nothing else), and ws_test_series_exam's UNIQUE
 * (test_series_id,exam_id) guards dup links.
 *
 * Run: DATABASE_URL='...' MONGODB_URI='...' npx tsx scripts/backfill-c4-testseries.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import { TestSeries } from "../src/models/testSeries/TestSeries.model";
import { TestSeriesContentCategory } from "../src/models/testSeries/TestSeriesContentCategory.model";
import { TestSeriesExam } from "../src/models/testSeries/TestSeriesExam.model";
import { Exam } from "../src/models/exam/Exam.model";

dotenv.config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });

  const tsByTitle = new Map(
    (await prisma.testSeries.findMany({ select: { id: true, title: true } })).map((t) => [t.title.trim(), t.id])
  );
  const examByTitle = new Map(
    (await prisma.exam.findMany({ select: { id: true, name: true } })).map((e) => [e.name.trim(), e.id])
  );

  // NET-NEW tables → clear for an idempotent re-run.
  await prisma.testSeriesExam.deleteMany({});
  await prisma.testSeriesContentCategory.deleteMany({});

  // ── content categories (mint fresh; build mongo _id → sql id map) ──
  const ccMap = new Map<string, number>();
  const ccs: any[] = await TestSeriesContentCategory.find({}).lean();
  let ccIns = 0, ccSkip = 0;
  for (const c of ccs) {
    const ts: any = await TestSeries.findById(c.testSeriesId).select("title").lean();
    const sqlTsId = ts?.title ? tsByTitle.get(ts.title.trim()) : undefined;
    if (!sqlTsId) { ccSkip++; continue; }
    const row = await prisma.testSeriesContentCategory.create({
      data: { testSeriesId: sqlTsId, name: c.name, icon: c.icon ?? null, orderBy: c.orderBy ?? 0, status: c.status ?? true, createdAt: c.createdAt ?? null, updatedAt: c.updatedAt ?? null },
    });
    ccMap.set(String(c._id), row.id);
    ccIns++;
  }
  console.log(`test_series_content_category: inserted=${ccIns} skipped=${ccSkip} (mongo total ${ccs.length})`);

  // ── exam links ──
  const links: any[] = await TestSeriesExam.find({}).lean();
  let lIns = 0, lSkip = 0;
  for (const l of links) {
    const ts: any = await TestSeries.findById(l.testSeriesId).select("title").lean();
    const sqlTsId = ts?.title ? tsByTitle.get(ts.title.trim()) : undefined;
    const sqlCcId = ccMap.get(String(l.contentCategoryId));
    const exam: any = await Exam.findById(l.examId).select("title").lean();
    const sqlExamId = exam?.title ? examByTitle.get(exam.title.trim()) : undefined;
    if (!sqlTsId || !sqlCcId || !sqlExamId) { lSkip++; continue; }
    try {
      await prisma.testSeriesExam.create({
        data: { testSeriesId: sqlTsId, contentCategoryId: sqlCcId, examId: sqlExamId, orderBy: l.orderBy ?? 0, status: l.status ?? true, createdAt: l.createdAt ?? null, updatedAt: l.updatedAt ?? null },
      });
      lIns++;
    } catch (e: any) {
      if (e?.code === "P2002") lSkip++;
      else throw e;
    }
  }
  console.log(`test_series_exam: inserted=${lIns} skipped=${lSkip} (mongo total ${links.length})`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
