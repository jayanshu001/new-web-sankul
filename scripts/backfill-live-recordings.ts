/*
 * Backfill the live-course RECORDING subsystem → SQL:
 *   Mongo VideoCategory{liveCourseId}      → ws_video_category (+ live_course_id, subject_key)
 *   Mongo Video{liveSessionId != null}     → ws_video (+ vcategory_id, live_session_id)
 *
 * These are the recording-promotion artifacts (folders + promoted lecture videos)
 * that drive GET /client/live-courses/:id/recordings + /lecture. NATURAL-KEY
 * bridged (no stored id map):
 *   liveCourse → ws_live_course by name   (live courses ARE backfilled, so they map)
 *   liveSession → ws_live_session by title + scheduledAt
 * Idempotent: folders keyed on (live_course_id, subject_key|title); videos on
 * (vcategory_id, title). Unmapped rows are SKIPPED, never guessed.
 *
 * Run: DATABASE_URL=... MONGODB_URI=... npx tsx scripts/backfill-live-recordings.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import { LiveCourse } from "../src/models/course/LiveCourse.model";
import { VideoCategory } from "../src/models/course/VideoCategory.model";
import { Video } from "../src/models/course/Video.model";
import { LiveSession } from "../src/models/course/LiveSession.model";

dotenv.config();

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200) || "folder";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });

  // live course Mongo _id → SQL id (by name)
  const sqlCourses = await prisma.liveCourse.findMany({ select: { id: true, name: true } });
  const courseByName = new Map(sqlCourses.filter((c) => c.name).map((c) => [c.name.trim(), c.id]));
  const liveCourseSqlId = async (mongoId: any): Promise<number | null> => {
    if (!mongoId) return null;
    const lc: any = await LiveCourse.findById(mongoId).select("name").lean();
    return lc?.name ? courseByName.get(String(lc.name).trim()) ?? null : null;
  };

  // live session Mongo _id → SQL id (title + scheduledAt)
  const sqlSessions = await prisma.liveSession.findMany({ select: { id: true, title: true, scheduledAt: true } });
  const sessKey = (t: string | null, d: Date | null) => `${(t ?? "").trim()}|${d ? new Date(d).getTime() : ""}`;
  const sessByKey = new Map(sqlSessions.map((s) => [sessKey(s.title, s.scheduledAt), s.id]));
  const liveSessionSqlId = async (mongoId: any): Promise<number | null> => {
    if (!mongoId) return null;
    const ms: any = await LiveSession.findById(mongoId).select("title scheduledAt").lean();
    return ms ? sessByKey.get(sessKey(ms.title ?? null, ms.scheduledAt ?? null)) ?? null : null;
  };

  // ── folders ────────────────────────────────────────────────────────────────
  const folderSqlByMongoId = new Map<string, number>();
  const folders: any[] = await VideoCategory.find({ liveCourseId: { $ne: null } }).lean();
  let fIns = 0, fSkip = 0;
  for (const f of folders) {
    const sqlCourse = await liveCourseSqlId(f.liveCourseId);
    if (!sqlCourse) { fSkip++; continue; }
    const subjectKey = f.subjectKey ?? null;
    const existing = await prisma.videoCategory.findFirst({
      where: { liveCourseId: sqlCourse, ...(subjectKey ? { subjectKey } : { title: f.title ?? "" }) },
      select: { id: true },
    });
    if (existing) { folderSqlByMongoId.set(String(f._id), existing.id); fSkip++; continue; }
    const row = await prisma.videoCategory.create({
      data: {
        title: f.title ?? "", slug: f.slug ?? slugify(f.title ?? ""), parent: 0, educatorId: 0,
        image: f.image ?? " ", pdf: f.pdf ?? " ", order_by: f.order_by ?? 0, status: f.status ?? true,
        subjectKey, liveCourseId: sqlCourse, created_at: f.createdAt ?? null, updated_at: f.updatedAt ?? null,
      } as any,
    });
    folderSqlByMongoId.set(String(f._id), row.id);
    fIns++;
  }
  console.log(`folders: inserted=${fIns} skipped=${fSkip} (mongo total ${folders.length})`);

  // ── promoted videos ──────────────────────────────────────────────────────────
  const vids: any[] = await Video.find({ liveSessionId: { $ne: null } }).lean();
  let vIns = 0, vSkip = 0;
  for (const v of vids) {
    const sqlVcat = folderSqlByMongoId.get(String(v.videoCategoryId));
    const sqlSession = await liveSessionSqlId(v.liveSessionId);
    if (!sqlVcat) { vSkip++; continue; }
    const dup = await prisma.video.findFirst({ where: { videoCategoryId: sqlVcat, title: v.title ?? "" }, select: { id: true } });
    if (dup) { vSkip++; continue; }
    await prisma.video.create({
      data: {
        videoCategoryId: sqlVcat, title: v.title ?? "", topic: (v.topic ?? "").slice(0, 25), platform: v.platform ?? "aws",
        slug: v.slug ?? slugify(v.title ?? ""), order: v.order ?? 0,
        priceType: v.priceType === "free" ? "free" : "paid", status: v.status ?? true,
        aws_id: v.aws_id ?? null, youtube_id: v.youtube_id ?? null, vimeo_id: v.vimeo_id ?? null,
        liveSessionId: sqlSession, created_at: v.createdAt ?? null, updated_at: v.updatedAt ?? null,
      } as any,
    });
    vIns++;
  }
  console.log(`promoted videos: inserted=${vIns} skipped=${vSkip} (mongo total ${vids.length})`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
