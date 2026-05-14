/**
 * Option A — start a REAL live lecture on Streamos for a live course.
 *
 * Exercises the live Streamos integration (createStream + streamDetails) and
 * persists a CREATED LiveSession so the customer "Live Now" tab and the demo
 * page pick it up.
 *
 *   ⚠ This provisions a REAL stream on Streamos. It stays live (consuming
 *     Streamos resources) until ended:
 *       npx tsx scripts/end-live-lecture.ts
 *     or  POST /api/v1/admin/live-sessions/end  { "streamId": <id> }
 *
 *   To get actual video, push to `rtmpUrl` from an encoder (OBS, etc.).
 *
 * Usage:  npx tsx scripts/start-live-lecture.ts [liveCourseId]
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { LiveCourse } from "../src/models/course/LiveCourse.model";
import { LiveSession } from "../src/models/course/LiveSession.model";
import {
  createStream,
  getStreamDetails,
  StreamosError,
} from "../src/admin/live/streamos.service";

const COURSE_ID = process.argv[2] || "6a058c63ea69f98d3d42f382";
const TITLE = "[TEST] Live Lecture — Streamos";

async function main() {
  await connectDB();

  const course = await LiveCourse.findById(COURSE_ID).select("_id name").lean();
  if (!course) throw new Error(`live course ${COURSE_ID} not found`);
  console.log(`Course: ${course.name} (${COURSE_ID})\n`);

  // Reuse an existing CREATED Streamos session for this course if present —
  // Streamos streams stay alive until explicitly ended.
  let session: any = await LiveSession.findOne({
    liveCourseIds: COURSE_ID,
    title: TITLE,
    status: "CREATED",
  });

  if (session) {
    console.log(`Reusing existing CREATED session ${session._id} (streamId ${session.streamId})\n`);
  } else {
    console.log("[1/2] Streamos createStream ...");
    let created;
    try {
      created = await createStream(TITLE);
    } catch (err) {
      if (err instanceof StreamosError) {
        console.error(`  ✗ createStream FAILED: ${err.message} (upstream ${err.upstreamStatus ?? "n/a"})`);
        console.error("  → Streamos integration is NOT working — check STREAMOS_ACCESS_KEY / STREAMOS_ACCESS_SECRET.");
        await mongoose.disconnect();
        process.exit(1);
      }
      throw err;
    }
    console.log(`  ✓ createStream OK — streamId ${created.streamId}`);

    session = await LiveSession.create({
      title: TITLE,
      liveCourseIds: [COURSE_ID],
      subject: "Streamos Live Test",
      status: "CREATED",
      streamId: created.streamId,
      rtmpUrl: created.rtmpUrl,
      hlsUrl: created.hlsUrl,
      hlsUrls: created.hlsUrls ?? null,
      recordings: [],
    });
    console.log(`  ✓ LiveSession persisted — ${session._id}`);
  }

  console.log("\n[2/2] Streamos streamDetails (verify) ...");
  try {
    const details = await getStreamDetails(session.streamId);
    console.log("  ✓ streamDetails OK");
    console.log(`     isLive : ${details.isLive}  (false until an encoder pushes to rtmpUrl)`);
    console.log(`     hlsUrl : ${details.hlsUrl || session.hlsUrl}`);
  } catch (err) {
    const msg =
      err instanceof StreamosError
        ? `${err.message} (upstream ${err.upstreamStatus ?? "n/a"})`
        : String((err as Error)?.message ?? err);
    console.error(`  ✗ streamDetails FAILED: ${msg}`);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("  Live lecture is UP (real Streamos stream)");
  console.log("──────────────────────────────────────────────");
  console.log(`  sessionId   : ${session._id}`);
  console.log(`  streamId    : ${session.streamId}`);
  console.log(`  liveClassId : ${session.streamId}   ← Socket.IO chat room id`);
  console.log(`  rtmpUrl     : ${session.rtmpUrl}   ← push video here from OBS`);
  console.log(`  hlsUrl      : ${session.hlsUrl}   ← players pull from here`);
  console.log("\n  ⚠ Real Streamos stream — END it when done testing:");
  console.log("      npx tsx scripts/end-live-lecture.ts");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Failed:", err?.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
