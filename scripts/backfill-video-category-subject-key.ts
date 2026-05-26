/**
 * One-shot backfill + cleanup for the subject-based recording grouping
 * migration.
 *
 * What changed in the schema:
 *   - VideoCategory: new optional `subjectKey` (normalized lowercase title),
 *     plus a partial-unique compound index on (liveCourseId, subjectKey).
 *     `image` is now optional.
 *   - LiveSession: `recordingTargetFolderId` is removed. Recording grouping
 *     is driven entirely by `session.subject` → `VideoCategory.subjectKey`.
 *
 * This script:
 *   1) For every VideoCategory under a liveCourse that has a non-empty
 *      title, set `subjectKey = normalize(title)`. Existing recorded-course
 *      folders (no liveCourseId) are left alone.
 *   2) Logs any (liveCourseId, subjectKey) collisions — these are pre-existing
 *      duplicate folders that the partial-unique index would reject. They
 *      MUST be merged manually before the index build succeeds.
 *   3) `$unset`s the removed `recordingTargetFolderId` field from every
 *      LiveSession that still carries it.
 *
 * Usage (dry-run by default — pass --apply to write):
 *   npx tsx scripts/backfill-video-category-subject-key.ts
 *   npx tsx scripts/backfill-video-category-subject-key.ts --apply
 */
import "dotenv/config";
import mongoose from "mongoose";
import { VideoCategory } from "../src/models/course/VideoCategory.model";
import { LiveSession } from "../src/models/course/LiveSession.model";
import { normalizeSubjectKey } from "../src/admin/live/recording.promote";

const APPLY = process.argv.includes("--apply");

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI / MONGODB_URI not set.");
  await mongoose.connect(uri);
  console.log(`[${APPLY ? "APPLY" : "DRY-RUN"}] connected.`);

  // 1) Backfill subjectKey on liveCourse folders.
  const folders = await VideoCategory.find({
    liveCourseId: { $ne: null },
    $or: [{ subjectKey: { $exists: false } }, { subjectKey: null }],
  })
    .select("_id liveCourseId title")
    .lean();

  console.log(`Found ${folders.length} liveCourse folders missing subjectKey.`);

  const collisions = new Map<string, string[]>(); // (liveCourseId|subjectKey) → [folderId, …]
  let toUpdate = 0;

  for (const f of folders) {
    const key = normalizeSubjectKey(f.title);
    if (!key) {
      console.warn(`  skip ${f._id} — empty/whitespace title.`);
      continue;
    }
    const combo = `${String(f.liveCourseId)}|${key}`;
    if (!collisions.has(combo)) collisions.set(combo, []);
    collisions.get(combo)!.push(String(f._id));
    toUpdate++;
  }

  const dupes = [...collisions.entries()].filter(([, ids]) => ids.length > 1);
  if (dupes.length > 0) {
    console.error(
      `\nFOUND ${dupes.length} duplicate (liveCourseId, subjectKey) groups. ` +
        `The unique index will REJECT these. Merge manually before applying.\n`
    );
    for (const [combo, ids] of dupes) {
      console.error(`  ${combo}\n    folders: ${ids.join(", ")}`);
    }
    if (APPLY) {
      console.error("Aborting --apply. Fix duplicates first.");
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  if (APPLY) {
    let written = 0;
    for (const f of folders) {
      const key = normalizeSubjectKey(f.title);
      if (!key) continue;
      await VideoCategory.updateOne({ _id: f._id }, { $set: { subjectKey: key } });
      written++;
    }
    console.log(`Updated subjectKey on ${written} folders.`);
  } else {
    console.log(`[dry-run] would update ${toUpdate} folders.`);
  }

  // 2) Drop the removed recordingTargetFolderId field from LiveSession.
  const stillHasField = await LiveSession.countDocuments({
    recordingTargetFolderId: { $exists: true },
  });
  console.log(`\nLiveSessions still carrying recordingTargetFolderId: ${stillHasField}`);

  if (APPLY && stillHasField > 0) {
    const res = await LiveSession.updateMany(
      { recordingTargetFolderId: { $exists: true } },
      { $unset: { recordingTargetFolderId: "" } }
    );
    console.log(`Unset on ${res.modifiedCount} sessions.`);
  }

  // 3) Force-rebuild indexes so the new partial-unique index is created.
  if (APPLY) {
    console.log("\nSyncing VideoCategory indexes…");
    await VideoCategory.syncIndexes();
    console.log("Indexes synced.");
  }

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
