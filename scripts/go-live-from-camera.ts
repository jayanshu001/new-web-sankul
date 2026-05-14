/**
 * Broadcast your laptop camera to a REAL live class — for proper end-to-end
 * testing of the live streaming flow.
 *
 * What it does:
 *   1. Goes live on Streamos for a live course (real stream).
 *   2. Persists the CREATED LiveSession so the customer "Live Now" tab + the
 *      demo page pick it up.
 *   3. Pushes your Mac's camera + mic to the Streamos RTMP endpoint via ffmpeg.
 *   4. Ctrl+C → stops ffmpeg, ends the Streamos stream, flips the session ENDED.
 *
 * Prerequisites:
 *   - ffmpeg:        brew install ffmpeg
 *   - Camera/Mic:    grant your terminal app access in
 *                    System Settings → Privacy & Security → Camera / Microphone
 *   - The API server should be running so customers can watch:  npm run dev
 *
 * Usage:
 *   npx tsx scripts/go-live-from-camera.ts [liveCourseId]
 *   AV_DEVICE="0:1" npx tsx scripts/go-live-from-camera.ts   # "<video>:<audio>"
 *   AV_DEVICE="0"   npx tsx scripts/go-live-from-camera.ts   # video only (no mic)
 *
 * Default AV_DEVICE is "0:1" — on this machine that's the FaceTime HD Camera +
 * MacBook Air Microphone. Audio index 0 here is a virtual device, hence ":1".
 * List devices for your machine:
 *   ffmpeg -f avfoundation -list_devices true -i ""
 */
import "dotenv/config";
import { spawn, spawnSync } from "child_process";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { LiveCourse } from "../src/models/course/LiveCourse.model";
import { LiveSession } from "../src/models/course/LiveSession.model";
import { createStream, endStream, StreamosError } from "../src/admin/live/streamos.service";

const COURSE_ID = process.argv[2] || "6a058c63ea69f98d3d42f382";
const TITLE = "[TEST] Camera Live";
// avfoundation "<video>:<audio>" device indices. Default "0:1" = FaceTime HD
// Camera + MacBook Air Microphone on this machine (audio 0 is a virtual
// device). Override with AV_DEVICE, or "0" for video-only.
const AV_DEVICE = process.env.AV_DEVICE || "0:1";

function hasFfmpeg(): boolean {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

async function main() {
  if (!hasFfmpeg()) {
    console.error(
      "ffmpeg is not installed.\n" +
        "  Install it:   brew install ffmpeg\n" +
        "  Then re-run:  npx tsx scripts/go-live-from-camera.ts"
    );
    process.exit(1);
  }

  await connectDB();

  const course = await LiveCourse.findById(COURSE_ID).select("_id name").lean();
  if (!course) throw new Error(`live course ${COURSE_ID} not found`);
  console.log(`Course: ${course.name} (${COURSE_ID})`);

  // End any prior camera-live session for this course — each run uses a fresh
  // Streamos push token, so stale ones are no use.
  const prior = await LiveSession.find({ liveCourseIds: COURSE_ID, title: TITLE, status: "CREATED" });
  for (const p of prior) {
    if (p.streamId) { try { await endStream(p.streamId); } catch { /* ignore */ } }
    p.status = "ENDED";
    await p.save();
  }
  if (prior.length) console.log(`(ended ${prior.length} stale camera-live session(s))`);

  // Go live on Streamos.
  console.log("Creating Streamos stream…");
  let created: Awaited<ReturnType<typeof createStream>> | null = null;
  try {
    created = await createStream(TITLE);
  } catch (err) {
    const msg =
      err instanceof StreamosError
        ? `${err.message} (upstream ${err.upstreamStatus ?? "n/a"})`
        : String((err as Error)?.message ?? err);
    console.error("createStream failed:", msg);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (!created) process.exit(1);

  const session = await LiveSession.create({
    title: TITLE,
    liveCourseIds: [COURSE_ID],
    subject: "Camera Live Test",
    status: "CREATED",
    streamId: created.streamId,
    rtmpUrl: created.rtmpUrl,
    hlsUrl: created.hlsUrl,
    hlsUrls: created.hlsUrls ?? null,
    recordings: [],
  });

  console.log("\n──────────────────────────────────────────────");
  console.log("  ● LIVE — pushing your camera to Streamos");
  console.log("──────────────────────────────────────────────");
  console.log(`  sessionId : ${session._id}`);
  console.log(`  streamId  : ${created.streamId}`);
  console.log(`  hlsUrl    : ${created.hlsUrl}`);
  console.log(`  WATCH IT  : http://localhost:4000/demo/live-course`);
  console.log(`              → customer login → section 3 "Live now" → Join "${TITLE}"`);
  console.log(`  STOP      : press Ctrl+C`);
  console.log("──────────────────────────────────────────────\n");

  // Capture camera + mic → encode → push to the RTMP endpoint.
  const ff = spawn(
    "ffmpeg",
    [
      "-f", "avfoundation",
      "-framerate", "30",
      "-i", AV_DEVICE,
      "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
      "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
      "-pix_fmt", "yuv420p", "-g", "60",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-f", "flv", created.rtmpUrl,
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );

  const streamId = created.streamId;
  let shuttingDown = false;
  async function shutdown(reason: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nStopping (${reason})…`);
    try { ff.kill("SIGINT"); } catch { /* ignore */ }
    try {
      await endStream(streamId);
      console.log("Streamos stream ended.");
    } catch (e) {
      console.error("endStream failed (non-fatal):", (e as Error).message);
    }
    try {
      await LiveSession.findByIdAndUpdate(session._id, { status: "ENDED" });
    } catch { /* ignore */ }
    console.log("Session marked ENDED.");
    console.log(
      "Note: ending here does NOT emit the `live_session_ended` socket event " +
        "(this runs outside the server process). To notify watching customers, " +
        "end via POST /api/v1/admin/live-sessions/end or the demo page's End button."
    );
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("Ctrl+C"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  ff.on("error", (e) => {
    console.error("ffmpeg failed to start:", e.message);
    void shutdown("ffmpeg error");
  });
  ff.on("exit", (code) => {
    if (shuttingDown) return;
    console.log(`ffmpeg exited (code ${code}). If this was immediate, check camera permissions or AV_DEVICE.`);
    void shutdown("ffmpeg exited");
  });
}

main().catch(async (err) => {
  console.error("Failed:", err?.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
