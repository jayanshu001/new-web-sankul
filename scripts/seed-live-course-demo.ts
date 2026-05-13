/**
 * Seed a sample LiveCourse + LiveCoursePlan + scheduled LiveSession for
 * testing the live-course / live-session flow end-to-end without going
 * through the admin UI.
 *
 * Usage (from repo root):
 *   npx tsx scripts/seed-live-course-demo.ts
 *
 * Idempotent. The course is keyed by `name` (which is uniquely indexed on
 * LiveCourse), so re-running will reuse the existing course + scheduled
 * session and only print the ids — it will not create duplicates.
 *
 * Reads MONGODB_URI from .env. Writes to the same database the running
 * server uses — be deliberate about which environment you point at.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { LiveCourse } from "../src/models/course/LiveCourse.model";
import { LiveCoursePlan } from "../src/models/course/LiveCoursePlan.model";
import { LiveSession } from "../src/models/course/LiveSession.model";
import { VideoCategory } from "../src/models/course/VideoCategory.model";

const SEED_NAME = "Demo Live Course (seed)";
const SCHEDULED_OFFSET_MINUTES = 5; // session scheduled this many min from now

async function main() {
  await connectDB();

  // --- LiveCourse (find-or-create + ensure root folder) ---------------------
  let course = await LiveCourse.findOne({ name: SEED_NAME });
  let rootFolder: any = null;

  if (!course) {
    course = await LiveCourse.create({
      name: SEED_NAME,
      description: "Auto-seeded course for testing the live-course flow.",
      image: "https://websankul-staging.blr1.digitaloceanspaces.com/seed/live-course.jpg",
      ordered: 999,
      level: "intermediate",
      status: true,
      isPaid: true,
      isPopular: false,
      withMaterial: "Includes hardcopy notes",
      withoutMaterial: "Live access only",
    });

    rootFolder = await VideoCategory.create({
      title: `${course.name} - Root`,
      slug: "demo-live-course-seed-root",
      image: course.image,
      liveCourseId: course._id,
      order_by: 0,
    });
    course.videoCategoryId = rootFolder._id;
    await course.save();
    console.log(`✓ Created LiveCourse ${course._id} + root folder ${rootFolder._id}`);
  } else {
    rootFolder = await VideoCategory.findOne({ liveCourseId: course._id, title: /Root$/ });
    if (!rootFolder) {
      rootFolder = await VideoCategory.create({
        title: `${course.name} - Root`,
        slug: "demo-live-course-seed-root",
        image: course.image,
        liveCourseId: course._id,
        order_by: 0,
      });
      course.videoCategoryId = rootFolder._id;
      await course.save();
      console.log(`✓ Restored root folder ${rootFolder._id} for existing course`);
    } else {
      console.log(`= LiveCourse already exists: ${course._id}`);
    }
  }

  // --- Default plan ---------------------------------------------------------
  let plan = await LiveCoursePlan.findOne({ liveCourseId: course._id, isDefault: true });
  if (!plan) {
    plan = await LiveCoursePlan.create({
      liveCourseId: course._id,
      name: "3 Months",
      duration: 3,
      price: 1999,
      isDefault: true,
      status: true,
    });
    console.log(`✓ Created default plan ${plan._id}`);
  } else {
    console.log(`= Default plan already exists: ${plan._id}`);
  }

  // --- Scheduled live session ----------------------------------------------
  let session = await LiveSession.findOne({
    title: "Demo Scheduled Session (seed)",
    liveCourseIds: course._id,
  });
  if (!session) {
    const scheduledAt = new Date(Date.now() + SCHEDULED_OFFSET_MINUTES * 60 * 1000);
    session = await LiveSession.create({
      title: "Demo Scheduled Session (seed)",
      liveCourseIds: [course._id],
      scheduledAt,
      status: "SCHEDULED",
      recordings: [],
    });
    console.log(
      `✓ Scheduled LiveSession ${session._id} at ${scheduledAt.toISOString()} ` +
        `(in ~${SCHEDULED_OFFSET_MINUTES} min, start window opens at ` +
        `${new Date(scheduledAt.getTime() - 2 * 60 * 1000).toISOString()})`
    );
  } else {
    console.log(`= Scheduled session already exists: ${session._id}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log("\n--- Postman variables to set ---");
  console.log(`live_course_id        = ${course._id}`);
  console.log(`live_course_folder_id = ${rootFolder._id}`);
  console.log(`live_course_plan_id   = ${plan._id}`);
  console.log(`live_session_id       = ${session._id}`);
  console.log("\nNext steps:");
  console.log("  1. In Postman, plug the four ids above into the matching collection variables.");
  console.log(`  2. Wait until ${SCHEDULED_OFFSET_MINUTES - 2}–3 min before the scheduled time, then call POST /api/v1/admin/live-sessions/:id/start.`);
  console.log(`  3. After it starts you'll have a streamId, rtmpUrl, hlsUrl — push to the rtmpUrl via OBS.`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
