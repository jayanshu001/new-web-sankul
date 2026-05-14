/**
 * Populate the "Constable Hybrid Offline + Live" live course with starter
 * content so the customer Videos / Schedule / purchase screens have data:
 *   - 1 default pricing plan (Figma values: ₹3999, MRP ₹14,999, 3 months)
 *   - 3 folders + a couple of placeholder lecture videos
 *   - 3 scheduled live sessions (subject + educator + time slot → Schedule tab)
 *   - 1 placeholder timetable file
 *
 * Idempotent — every entity is matched by a natural key and only created if
 * missing, so this is safe to re-run.
 *
 * Placeholder content (video URLs, the timetable-file URL) is clearly fake —
 * replace it via the admin APIs.
 *
 * Usage (from repo root):
 *   npx tsx scripts/seed-constable-live-course.ts
 */
import "dotenv/config";
import mongoose, { Types } from "mongoose";
import connectDB from "../src/config/db";
import { LiveCourse } from "../src/models/course/LiveCourse.model";
import { LiveCoursePlan } from "../src/models/course/LiveCoursePlan.model";
import { LiveSession } from "../src/models/course/LiveSession.model";
import { VideoCategory } from "../src/models/course/VideoCategory.model";
import { Video } from "../src/models/course/Video.model";
import { CourseEducator } from "../src/models/course/CourseEducator.model";

const COURSE_NAME = "Constable Hybrid Offline + Live";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function main() {
  await connectDB();

  const course = await LiveCourse.findOne({ name: COURSE_NAME });
  if (!course) {
    throw new Error(`Live course "${COURSE_NAME}" not found — run create-live-course.ts first.`);
  }
  const courseId = course._id as Types.ObjectId;
  console.log("Live course:", String(courseId));

  // optional educator for the timetable rows / course header
  const educator = await CourseEducator.findOne().select("_id name").lean();
  const educatorId = educator ? (educator._id as Types.ObjectId) : null;
  if (educatorId && !course.courseEducatorId) {
    course.courseEducatorId = educatorId;
  }
  console.log("Educator:", educator ? `${educator.name} (${educatorId})` : "none found — sessions left without educator");

  // ── 1. Pricing plan ──────────────────────────────────────────────────────
  let plan = await LiveCoursePlan.findOne({ liveCourseId: courseId });
  if (!plan) {
    plan = await LiveCoursePlan.create({
      liveCourseId: courseId,
      name: "3 Months",
      duration: 3,
      price: 3999,
      originalPrice: 14999, // → discountPercent computes to 73%
      isDefault: true,
      status: true,
    });
    console.log("  + plan created:", String(plan._id), "(₹3999, MRP ₹14,999, 3 months)");
  } else {
    console.log("  = plan already exists:", String(plan._id));
  }

  // ── 2. Folders ───────────────────────────────────────────────────────────
  const folderTitles = ["Current Affairs", "Indian Geography", "History"];
  const folders: Record<string, Types.ObjectId> = {};
  for (const [i, title] of folderTitles.entries()) {
    let folder = await VideoCategory.findOne({ liveCourseId: courseId, title });
    if (!folder) {
      folder = await VideoCategory.create({
        title,
        slug: `${slugify(COURSE_NAME)}-${slugify(title)}`,
        image: course.image,
        liveCourseId: courseId,
        order_by: i + 1,
        status: true,
      });
      console.log(`  + folder created: ${title} (${folder._id})`);
    } else {
      console.log(`  = folder exists:  ${title}`);
    }
    folders[title] = folder._id as Types.ObjectId;
  }

  // ── 3. Placeholder lecture videos ────────────────────────────────────────
  // platform "aws" + a clearly-fake URL — replace with real recordings/links.
  const videoSpecs = [
    { folder: "Current Affairs", title: "Current Affairs — Week 1", order: 0 },
    { folder: "Current Affairs", title: "Current Affairs — Week 2", order: 1 },
    { folder: "History", title: "Modern History — Intro", order: 0 },
  ];
  for (const v of videoSpecs) {
    const existing = await Video.findOne({ videoCategoryId: folders[v.folder], title: v.title });
    if (!existing) {
      const doc = await Video.create({
        videoCategoryId: folders[v.folder],
        title: v.title,
        platform: "aws",
        aws_id: `https://placeholder.websankul.com/${slugify(v.title)}.mp4`,
        priceType: "paid",
        order: v.order,
        status: true,
      });
      console.log(`  + video created:  ${v.title} (${doc._id})`);
    } else {
      console.log(`  = video exists:   ${v.title}`);
    }
  }

  // ── 4. Scheduled live sessions (feed the Schedule tab) ───────────────────
  // Three upcoming classes, 09:00–10:00.
  const sessionSpecs = [
    { title: "Live Class — Mathematics",      subject: "Mathematics",      date: "2026-05-17" },
    { title: "Live Class — Current Affairs",  subject: "Current Affairs",  date: "2026-05-18" },
    { title: "Live Class — Indian Geography", subject: "Indian Geography", date: "2026-05-20" },
  ];
  for (const s of sessionSpecs) {
    const existing = await LiveSession.findOne({ liveCourseIds: courseId, title: s.title });
    if (!existing) {
      const doc = await LiveSession.create({
        title: s.title,
        liveCourseIds: [courseId],
        subject: s.subject,
        educatorId,
        scheduledAt: new Date(`${s.date}T09:00:00.000Z`),
        endAt: new Date(`${s.date}T10:00:00.000Z`),
        status: "SCHEDULED",
        recordings: [],
      });
      console.log(`  + session created: ${s.title} @ ${s.date} (${doc._id})`);
    } else {
      console.log(`  = session exists:  ${s.title}`);
    }
  }

  // ── 5. Timetable file (placeholder) ──────────────────────────────────────
  if (!course.timetableFiles || course.timetableFiles.length === 0) {
    course.timetableFiles = [
      { title: "Batch Time Table", fileUrl: "https://placeholder.websankul.com/constable-timetable.pdf", order: 0 },
    ];
    console.log("  + timetable file added (placeholder)");
  } else {
    console.log("  = timetable files already set");
  }

  await course.save();

  console.log("\nDone. The course now has a plan, folders + videos, scheduled sessions, and a timetable file.");
  console.log("Placeholder URLs (videos, timetable file) and the cover image should be replaced via the admin APIs.");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Seed failed:", err?.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
