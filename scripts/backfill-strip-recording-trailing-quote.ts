/**
 * One-shot backfill: strip trailing-quote artifacts from recording URLs.
 *
 * Background:
 *   Streamos has shipped recording paths with a stray trailing quote — raw `"`,
 *   URL-encoded `%22`, or double-encoded `%2522`. The webhook ingest at
 *   live.controller.ts strips these on receipt, and recording.promote.ts strips
 *   again on promotion, but rows persisted before those guards were added
 *   still carry the suffix and are unplayable (the player 404s on the literal
 *   URL with the quote appended).
 *
 *   This script normalizes:
 *     1. LiveSession.recordings[].path
 *     2. Video.aws_id (when aws_id is a Streamos-style path stored by the
 *        promotion pipeline — dedupe key is the URL itself)
 *
 *   Idempotent — strip-then-compare; only writes when the value actually
 *   changes.
 *
 * Usage (dry-run by default — pass --apply to write):
 *   npx tsx scripts/backfill-strip-recording-trailing-quote.ts
 *   npx tsx scripts/backfill-strip-recording-trailing-quote.ts --apply
 */
import "dotenv/config";
import mongoose from "mongoose";
import { LiveSession } from "../src/models/course/LiveSession.model";
import { Video } from "../src/models/course/Video.model";

const TRAILING_QUOTE = /(?:"|%22|%2522)+$/i;

function strip(value: string): string {
  return value.replace(TRAILING_QUOTE, "");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGO_URI / MONGODB_URI not set");

  await mongoose.connect(mongoUri);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY-RUN"}`);

  // --- LiveSession.recordings[].path ----------------------------------------
  const sessions = await LiveSession.find({ "recordings.0": { $exists: true } })
    .select("_id recordings")
    .lean();

  let sessionsTouched = 0;
  let pathsFixed = 0;
  for (const s of sessions) {
    const before = s.recordings ?? [];
    const after = before.map((r) => ({
      ...r,
      path: typeof r.path === "string" ? strip(r.path) : r.path,
    }));
    const changed = after.some((r, i) => r.path !== before[i]?.path);
    if (!changed) continue;
    sessionsTouched += 1;
    pathsFixed += after.filter((r, i) => r.path !== before[i]?.path).length;
    if (apply) {
      await LiveSession.updateOne({ _id: s._id }, { $set: { recordings: after } });
    }
  }
  console.log(`LiveSessions: ${sessionsTouched} touched, ${pathsFixed} paths fixed.`);

  // --- Video.aws_id ---------------------------------------------------------
  // Only Streamos-style paths (containing %22 / trailing quote) need touching.
  // We match on the trailing artifact rather than scanning all videos.
  const videos = await Video.find({
    aws_id: { $regex: /(?:"|%22|%2522)+$/i },
  })
    .select("_id aws_id")
    .lean();

  let videosFixed = 0;
  for (const v of videos) {
    if (typeof v.aws_id !== "string") continue;
    const next = strip(v.aws_id);
    if (next === v.aws_id) continue;
    videosFixed += 1;
    if (apply) {
      await Video.updateOne({ _id: v._id }, { $set: { aws_id: next } });
    }
  }
  console.log(`Videos: ${videosFixed} aws_id values fixed.`);

  await mongoose.disconnect();
  console.log(apply ? "Done (changes written)." : "Done (dry-run — pass --apply to write).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
