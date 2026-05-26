/**
 * One-shot backfill for "stranded READY" live sessions.
 *
 * Background:
 *   Before the subject-based grouping change, recordings only auto-promoted
 *   into a folder when the admin had set `recordingTargetFolderId` at
 *   schedule time. Sessions without that field stayed in status: READY with
 *   `recordings[]` populated on the LiveSession, but no corresponding Video
 *   document — so the customer-facing /recordings endpoint never showed them.
 *
 *   After the change, `maybeAutoPromoteRecording` resolves a folder per
 *   (liveCourseId, normalize(subject)) and creates it on demand. This script
 *   reruns that helper for every existing READY session, retroactively
 *   creating the subject folders and Video docs so the mobile listing
 *   catches up to the admin listing.
 *
 *   Idempotent — `promoteRecordingToFolder` dedupes per folder by `aws_id`,
 *   so re-running is safe.
 *
 * Skips:
 *   - sessions with empty/whitespace `subject` (no grouping key available)
 *   - sessions with empty `recordings[]` (nothing to promote)
 *   - sessions with no `liveCourseIds` (no course to file under)
 *
 * Usage (dry-run by default — pass --apply to write):
 *   npx tsx scripts/backfill-stranded-ready-sessions.ts
 *   npx tsx scripts/backfill-stranded-ready-sessions.ts --apply
 *
 * Optional course filter:
 *   npx tsx scripts/backfill-stranded-ready-sessions.ts --apply --course=<liveCourseId>
 */
import "dotenv/config";
import mongoose from "mongoose";
import { LiveSession } from "../src/models/course/LiveSession.model";
import { Video } from "../src/models/course/Video.model";
import {
  maybeAutoPromoteRecording,
  normalizeSubjectKey,
} from "../src/admin/live/recording.promote";

const APPLY = process.argv.includes("--apply");
const COURSE_ARG = process.argv.find((a) => a.startsWith("--course="));
const COURSE_ID = COURSE_ARG ? COURSE_ARG.split("=")[1] : null;

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI / MONGODB_URI not set.");
  await mongoose.connect(uri);
  console.log(`[${APPLY ? "APPLY" : "DRY-RUN"}] connected.`);

  const query: Record<string, any> = {
    status: "READY",
    "recordings.0": { $exists: true }, // at least one recording
  };
  if (COURSE_ID) {
    if (!/^[0-9a-fA-F]{24}$/.test(COURSE_ID)) {
      throw new Error(`--course expects a valid ObjectId, got "${COURSE_ID}".`);
    }
    query.liveCourseIds = new mongoose.Types.ObjectId(COURSE_ID);
  }

  const sessions = await LiveSession.find(query);
  console.log(`Found ${sessions.length} READY session(s) with recordings.`);

  // Buckets so the dry-run report is actionable.
  const skipNoSubject: string[] = [];
  const skipNoCourse: string[] = [];
  const alreadyFiled: string[] = [];
  const willPromote: Array<{ id: string; subject: string; courses: number }> = [];

  for (const s of sessions) {
    const subjectKey = normalizeSubjectKey(s.subject);
    if (!subjectKey) {
      skipNoSubject.push(String(s._id));
      continue;
    }
    if (!s.liveCourseIds || s.liveCourseIds.length === 0) {
      skipNoCourse.push(String(s._id));
      continue;
    }

    // Heuristic check: does this session already have a Video filed somewhere?
    // If yes — likely the new logic already ran. We still call the helper to
    // cover the per-liveCourseId fan-out (a session may be filed in one
    // course's subject folder but missing in another). The promote helper is
    // idempotent per (folder, aws_id), so this is safe.
    const existingFiled = await Video.exists({ liveSessionId: s._id });
    if (existingFiled) alreadyFiled.push(String(s._id));

    willPromote.push({
      id: String(s._id),
      subject: s.subject ?? "",
      courses: s.liveCourseIds.length,
    });
  }

  console.log("\n── Plan ──────────────────────────────────────────────");
  console.log(`  to promote:               ${willPromote.length}`);
  console.log(`  (of which already filed): ${alreadyFiled.length}`);
  console.log(`  skip — no subject:        ${skipNoSubject.length}`);
  console.log(`  skip — no liveCourseIds:  ${skipNoCourse.length}`);

  if (skipNoSubject.length > 0) {
    console.log("\n  Sessions skipped for empty subject (manual fix needed):");
    for (const id of skipNoSubject) console.log(`    ${id}`);
  }
  if (skipNoCourse.length > 0) {
    console.log("\n  Sessions skipped for no liveCourseIds:");
    for (const id of skipNoCourse) console.log(`    ${id}`);
  }

  if (!APPLY) {
    console.log("\n[dry-run] not writing. Re-run with --apply to promote.");
    await mongoose.disconnect();
    return;
  }

  console.log("\n── Applying ──────────────────────────────────────────");
  let okCount = 0;
  let errCount = 0;
  for (const s of sessions) {
    const subjectKey = normalizeSubjectKey(s.subject);
    if (!subjectKey) continue;
    if (!s.liveCourseIds || s.liveCourseIds.length === 0) continue;

    try {
      // The helper is intentionally non-throwing (logs internally), but wrap
      // anyway so a single bad session can't kill the run.
      await maybeAutoPromoteRecording(s);
      okCount++;
      process.stdout.write(".");
    } catch (err) {
      errCount++;
      console.error(`\n  ! ${s._id}: ${(err as Error).message}`);
    }
  }
  process.stdout.write("\n");

  console.log(`\nDone. promoted=${okCount} errors=${errCount}`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
