/*
 * Backfill ws_lecture_note + ws_lecture_audio_note from Mongo.
 * Mongo ids are ObjectIds; SQL ids are ints. Customer/video/session/course
 * cross-store ids generally DON'T bridge in staging (test users/content not in
 * the SQL dump) — we store best-effort: numeric-looking ids pass through, else 0.
 * This mirrors the Wave-7 net-new-table backfill behaviour (runtime path is the
 * real one; backfill is best-effort for historical rows). Idempotent: truncates.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";

dotenv.config();

// ObjectId/whatever → int if it's a plain integer string, else null.
const toInt = (v: any): number | null => {
  if (v == null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? Number(s) : null;
};
const toIntArr = (a: any): number[] =>
  Array.isArray(a) ? a.map(toInt).filter((n): n is number => n != null) : [];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  await prisma.lectureNote.deleteMany({});
  await prisma.lectureAudioNote.deleteMany({});

  const notes = await db.collection("ws_lecture_notes").find({}).toArray();
  let n = 0, skipped = 0;
  for (const d of notes) {
    const cid = toInt(d.customerId);
    if (cid == null) { skipped++; continue; } // can't key a note without a SQL customer
    await prisma.lectureNote.create({
      data: {
        customerId: cid,
        lectureType: d.lectureType ?? "recorded",
        videoId: toInt(d.videoId),
        liveSessionId: toInt(d.liveSessionId),
        courseId: toInt(d.courseId),
        liveCourseIds: toIntArr(d.liveCourseIds),
        timestampSec: d.timestampSec ?? 0,
        content: d.content ?? "",
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
      },
    });
    n++;
  }
  console.log(`lecture_note: ${n} inserted, ${skipped} skipped (no SQL customer id)`);

  const anotes = await db.collection("ws_lecture_audio_notes").find({}).toArray();
  let an = 0, askipped = 0;
  for (const d of anotes) {
    const cid = toInt(d.customerId);
    if (cid == null) { askipped++; continue; }
    await prisma.lectureAudioNote.create({
      data: {
        customerId: cid,
        lectureType: d.lectureType ?? "recorded",
        videoId: toInt(d.videoId),
        liveSessionId: toInt(d.liveSessionId),
        courseId: toInt(d.courseId),
        liveCourseIds: toIntArr(d.liveCourseIds),
        timestampSec: d.timestampSec ?? 0,
        title: d.title ?? null,
        audioUrl: d.audioUrl ?? "",
        audioKey: d.audioKey ?? "",
        mimeType: d.mimeType ?? null,
        sizeBytes: d.sizeBytes ?? null,
        durationSec: d.durationSec ?? null,
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
      },
    });
    an++;
  }
  console.log(`lecture_audio_note: ${an} inserted, ${askipped} skipped (no SQL customer id)`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
