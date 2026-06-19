/*
 * Backfill the embedded examCountdown columns on the catalog tables (C6):
 *   ws_book / ws_course / ws_ebook . exam_countdown_ids + exam_countdown_category_ids
 *
 * Source: the Mongo Book/Course/Ebook docs' examCountdownIds[] +
 * examCountdownCategoryIds[] (arrays of ObjectIds). We translate each ObjectId →
 * SQL int via NATURAL KEY (countdown by title, category by name), and match the
 * catalog row Mongo→SQL by name. Unmapped ids/rows are SKIPPED (never guessed).
 * Idempotent: it overwrites the two JSON columns on matched rows.
 *
 * Run: DATABASE_URL='...' MONGODB_URI='...' npx tsx scripts/backfill-c6-examcountdown-cols.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import { Book } from "../src/models/book/Book.model";
import { Course } from "../src/models/course/Course.model";
import { Ebook } from "../src/models/ebook/Ebook.model";
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

  const doEntity = async (label: string, mongoRows: any[], update: (sqlId: number, cd: number[], cat: number[]) => Promise<any>, sqlByName: Map<string, number>) => {
    let upd = 0, skip = 0;
    for (const r of mongoRows) {
      const sqlId = r.name ? sqlByName.get(String(r.name).trim()) : undefined;
      const cd = toSqlCdIds(r.examCountdownIds);
      const cat = toSqlCatIds(r.examCountdownCategoryIds);
      if (!sqlId || (!cd.length && !cat.length)) { skip++; continue; }
      await update(sqlId, cd, cat);
      upd++;
    }
    console.log(`${label}: updated=${upd} skipped=${skip} (mongo total ${mongoRows.length})`);
  };

  const bookByName = new Map((await prisma.book.findMany({ select: { id: true, name: true } })).filter((b) => b.name).map((b) => [b.name!.trim(), b.id]));
  const courseByName = new Map((await prisma.course.findMany({ select: { id: true, name: true } })).filter((c) => c.name).map((c) => [c.name!.trim(), c.id]));
  const ebookByName = new Map((await prisma.eBook.findMany({ select: { id: true, name: true } })).filter((e) => e.name).map((e) => [e.name!.trim(), e.id]));

  await doEntity("ws_book", await Book.find({}).select("name examCountdownIds examCountdownCategoryIds").lean<any[]>(),
    (id, cd, cat) => prisma.book.update({ where: { id }, data: { examCountdownIds: cd as any, examCountdownCategoryIds: cat as any } }), bookByName);
  await doEntity("ws_course", await Course.find({}).select("name examCountdownIds examCountdownCategoryIds").lean<any[]>(),
    (id, cd, cat) => prisma.course.update({ where: { id }, data: { examCountdownIds: cd as any, examCountdownCategoryIds: cat as any } }), courseByName);
  await doEntity("ws_ebook", await Ebook.find({}).select("name examCountdownIds examCountdownCategoryIds").lean<any[]>(),
    (id, cd, cat) => prisma.eBook.update({ where: { id }, data: { examCountdownIds: cd as any, examCountdownCategoryIds: cat as any } }), ebookByName);

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
