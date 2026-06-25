/*
 * Backfill the embedded examCountdown columns on ws_package (2026-06-25):
 *   ws_package.exam_countdown_ids + exam_countdown_category_ids
 *
 * Source: the Mongo Package docs' examCountdownIds[] + examCountdownCategoryIds[]
 * (arrays of ObjectIds). Each ObjectId → SQL int via NATURAL KEY (countdown by
 * title, category by name); the package row is matched Mongo→SQL by name.
 * Unmapped ids/rows are SKIPPED (never guessed). Idempotent: overwrites the two
 * JSON columns on matched rows.
 *
 * Mirrors scripts/backfill-c6-examcountdown-cols.ts (which did the same for
 * ws_book/ws_course/ws_ebook). Needed so the client exam-countdown package
 * listings (/client/exam-countdown-categories/:id/packages and
 *  /client/exam-countdown/:id/packages) surface existing packages on MySQL.
 *
 * Run: DATABASE_URL='...' MONGODB_URI='...' npx tsx scripts/backfill-package-examcountdown-cols.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import { Package } from "../src/models/course/Package.model";
import { ExamCountdown } from "../src/models/examCountdown/ExamCountdown.model";
import { ExamCountdownCategory } from "../src/models/examCountdown/ExamCountdownCategory.model";

dotenv.config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });

  // SQL natural-key maps
  const cdByTitle = new Map((await prisma.examCountdown.findMany({ select: { id: true, title: true } })).map((c) => [c.title.trim(), c.id]));
  const catByName = new Map((await prisma.examCountdownCategory.findMany({ select: { id: true, name: true } })).map((c) => [c.name.trim(), c.id]));

  // Mongo ObjectId → title/name (to translate the embedded arrays)
  const mCd = new Map((await ExamCountdown.find({}).select("title").lean<any[]>()).map((c: any) => [String(c._id), String(c.title ?? "")]));
  const mCat = new Map((await ExamCountdownCategory.find({}).select("name").lean<any[]>()).map((c: any) => [String(c._id), String(c.name ?? "")]));

  const toSqlCdIds = (ids: any[]) => (ids ?? []).map((id) => cdByTitle.get((mCd.get(String(id)) ?? "").trim())).filter((x): x is number => x != null);
  const toSqlCatIds = (ids: any[]) => (ids ?? []).map((id) => catByName.get((mCat.get(String(id)) ?? "").trim())).filter((x): x is number => x != null);

  const pkgByName = new Map((await prisma.package.findMany({ select: { id: true, name: true } })).filter((p) => p.name).map((p) => [p.name.trim(), p.id]));

  const rows = await Package.find({}).select("name examCountdownIds examCountdownCategoryIds").lean<any[]>();
  let upd = 0, skip = 0;
  for (const r of rows) {
    const sqlId = r.name ? pkgByName.get(String(r.name).trim()) : undefined;
    const cd = toSqlCdIds(r.examCountdownIds);
    const cat = toSqlCatIds(r.examCountdownCategoryIds);
    if (!sqlId || (!cd.length && !cat.length)) { skip++; continue; }
    await prisma.package.update({ where: { id: sqlId }, data: { examCountdownIds: cd as any, examCountdownCategoryIds: cat as any } });
    upd++;
  }
  console.log(`ws_package: updated=${upd} skipped=${skip} (mongo total ${rows.length})`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
