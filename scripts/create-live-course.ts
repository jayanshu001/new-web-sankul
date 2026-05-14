/**
 * Create the "Constable Hybrid Offline + Live" live course so it shows up in
 * the customer list (GET /api/v1/client/live-courses filters status: true).
 *
 * Mirrors the POST /admin/live-courses controller: creates the LiveCourse plus
 * its root VideoCategory folder and links them. Idempotent — keyed by `name`
 * (uniquely indexed), so re-running just prints the existing ids.
 *
 * Usage (from repo root):
 *   npx tsx scripts/create-live-course.ts
 */
import "dotenv/config";
import mongoose, { Types } from "mongoose";
import connectDB from "../src/config/db";
import { LiveCourse } from "../src/models/course/LiveCourse.model";
import { VideoCategory } from "../src/models/course/VideoCategory.model";

const COURSE = {
  name: "Constable Hybrid Offline + Live",
  description: "PSI Constable Fastrack Hybrid Batch",
  // Placeholder — replace with the real cover image via PUT /admin/live-courses/:id.
  image: "https://websankul-staging.blr1.digitaloceanspaces.com/seed/live-course.jpg",
  level: "intermediate",
  classType: "live_offline" as const, // renders as "Live + Offline"
  status: true,
  isPaid: true,
};

async function main() {
  await connectDB();

  let course = await LiveCourse.findOne({ name: COURSE.name });
  if (course) {
    console.log("Live course already exists — nothing to create.");
  } else {
    // Append to the end of the list rather than jumping the existing order.
    const last = await LiveCourse.findOne().sort({ ordered: -1 }).select("ordered").lean();
    const ordered = (last?.ordered ?? 0) + 1;

    course = await LiveCourse.create({ ...COURSE, ordered });

    const slug = course.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const rootFolder = await VideoCategory.create({
      title: `${course.name} - Root`,
      slug: `${slug}-root`,
      image: course.image,
      liveCourseId: course._id,
      order_by: 0,
    });

    course.videoCategoryId = rootFolder._id as Types.ObjectId;
    await course.save();

    console.log("Created live course + root folder.");
    console.log("  rootFolderId:", String(rootFolder._id));
  }

  console.log("  liveCourseId:", String(course._id));
  console.log("  name        :", course.name);
  console.log("  status      :", course.status, "(true → visible in the customer list)");
  console.log("  classType   :", course.classType);
  console.log("  ordered     :", course.ordered);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Create failed:", err?.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
