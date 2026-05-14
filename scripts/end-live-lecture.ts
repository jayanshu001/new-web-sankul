/**
 * The off-switch for scripts/start-live-lecture.ts — ends the REAL Streamos
 * stream and flips the session to ENDED. Run this when done testing so the
 * Streamos stream isn't left running.
 *
 * Ends the "[TEST] Live Lecture — Streamos" session on the given course.
 * Pass a specific streamId to end any other session instead.
 *
 * Usage:
 *   npx tsx scripts/end-live-lecture.ts                 # ends the test lecture
 *   npx tsx scripts/end-live-lecture.ts <streamId>      # ends a specific stream
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { LiveSession } from "../src/models/course/LiveSession.model";
import { endStream, StreamosError } from "../src/admin/live/streamos.service";

const COURSE_ID = "6a058c63ea69f98d3d42f382";
const TITLE = "[TEST] Live Lecture — Streamos";
const explicitStreamId = process.argv[2];

async function main() {
  await connectDB();

  let session: any;
  if (explicitStreamId) {
    session = await LiveSession.findOne({ streamId: explicitStreamId });
  } else {
    session = await LiveSession.findOne({
      liveCourseIds: COURSE_ID,
      title: TITLE,
      status: "CREATED",
    });
  }

  if (!session) {
    console.log("No matching CREATED live lecture found — nothing to end.");
    await mongoose.disconnect();
    return;
  }
  if (!session.streamId) {
    console.log(`Session ${session._id} has no streamId — marking ENDED in DB only.`);
  } else {
    console.log(`Ending Streamos stream ${session.streamId} ...`);
    try {
      await endStream(session.streamId);
      console.log("  ✓ Streamos endStream OK");
    } catch (err) {
      const msg =
        err instanceof StreamosError
          ? `${err.message} (upstream ${err.upstreamStatus ?? "n/a"})`
          : String((err as Error)?.message ?? err);
      console.error(`  ✗ Streamos endStream failed: ${msg} — flipping DB status anyway.`);
    }
  }

  session.status = "ENDED";
  await session.save();
  console.log(`Session ${session._id} → status ENDED.`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Failed:", err?.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
