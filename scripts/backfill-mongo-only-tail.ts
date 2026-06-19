/*
 * Backfill the Mongo-only tail collections into their new SQL tables:
 *   ws_exam_countdown_categories → ws_exam_countdown_category
 *   ws_exam_countdowns           → ws_exam_countdown
 *   ws_package_categories        → ws_package_category
 *   ws_image_notifications       → ws_image_notification
 *
 * Strategy: preserve the Mongo _id ordering, but assign FRESH SQL int ids
 * (auto-increment). ExamCountdown.categoryId is remapped from the Mongo
 * category ObjectId → the new SQL category id via a lookup map built in the
 * same run. Idempotent: truncates the 4 tables first (small reference data).
 *
 * Run: DATABASE_URL='...' npx tsx scripts/backfill-mongo-only-tail.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";

dotenv.config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  // Clear (FK-soft, so order is cosmetic) — these are small reference tables.
  await prisma.examCountdown.deleteMany({});
  await prisma.examCountdownCategory.deleteMany({});
  await prisma.packageCategory.deleteMany({});
  await prisma.imageNotification.deleteMany({});

  // ── 1. exam countdown categories (build mongoId → sqlId map) ──
  const catMap = new Map<string, number>();
  const cats = await db.collection("ws_exam_countdown_categories").find({}).sort({ order: 1, _id: 1 }).toArray();
  for (const c of cats) {
    const row = await prisma.examCountdownCategory.create({
      data: {
        name: c.name, colorHex: c.colorHex ?? "#000000",
        order: c.order ?? 0, status: c.status ?? true,
        createdAt: c.createdAt ?? null, updatedAt: c.updatedAt ?? null,
      },
    });
    catMap.set(String(c._id), row.id);
  }
  console.log(`exam_countdown_category: ${cats.length}`);

  // ── 2. exam countdowns (remap categoryId) ──
  const ecs = await db.collection("ws_exam_countdowns").find({}).sort({ _id: 1 }).toArray();
  for (const e of ecs) {
    await prisma.examCountdown.create({
      data: {
        title: e.title,
        categoryId: e.categoryId ? catMap.get(String(e.categoryId)) ?? null : null,
        examDate: e.examDate ? new Date(e.examDate) : new Date(),
        description: e.description ?? null, status: e.status ?? true,
        createdAt: e.createdAt ?? null, updatedAt: e.updatedAt ?? null,
      },
    });
  }
  console.log(`exam_countdown: ${ecs.length}`);

  // ── 3. package categories ──
  const pcs = await db.collection("ws_package_categories").find({}).sort({ order: 1, _id: 1 }).toArray();
  for (const p of pcs) {
    await prisma.packageCategory.create({
      data: {
        title: p.title, slug: p.slug, image: p.image ?? null,
        order: p.order ?? 0, status: p.status ?? true,
        createdAt: p.createdAt ?? null, updatedAt: p.updatedAt ?? null,
      },
    });
  }
  console.log(`package_category: ${pcs.length}`);

  // ── 4. image notifications (no timestamps) ──
  const ins = await db.collection("ws_image_notifications").find({}).sort({ _id: 1 }).toArray();
  for (const i of ins) {
    await prisma.imageNotification.create({
      data: { image: i.image, redirect_url: i.redirectUrl ?? null, active: i.active ?? true } as any,
    });
  }
  console.log(`image_notification: ${ins.length}`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  console.log("✅ backfill complete");
  process.exit(0);
})();
