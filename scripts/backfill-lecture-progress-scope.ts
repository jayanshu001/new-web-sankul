/**
 * One-shot backfill for the per-scope LectureProgress split.
 *
 * Context: until this change, LectureProgress had one row per
 *   (customer, videoId)  OR  (customer, liveSessionId)
 * with parent pointers (courseId / liveCourseId / packageId) denormalised
 * onto whichever single row existed. That meant the same lecture watched
 * via two containers (e.g. a Course and a Package) collapsed into one row.
 *
 * After this change, the unique key is per scope:
 *   (customer, videoId, scopeKind, courseId|liveCourseId|packageId)
 * scopeKind ∈ {"course", "liveCourse", "package"}.
 *
 * This script:
 *   1) drops the OLD non-partial unique indexes that would block per-scope
 *      copies sharing a (customer, videoId).
 *   2) ensures the NEW partial-unique indexes from the schema are built.
 *   3) for every legacy row (scopeKind == null), fans it out into one row
 *      per non-null parent pointer it carries (course / liveCourse /
 *      package), copying positionSec / durationSec / completed /
 *      completedAt / lastWatchedAt. The "active" scope a user chose at
 *      watch time is unrecoverable from legacy rows, so we conservatively
 *      mirror progress into every container the user could see the
 *      lecture under — same UX as today's collapsed row, but now keyed
 *      per scope so new heartbeats can diverge.
 *   4) deletes the legacy row after its fan-out copies are written.
 *
 * Usage (dry-run by default — pass --apply to write):
 *   npx ts-node scripts/backfill-lecture-progress-scope.ts            # dry-run
 *   npx ts-node scripts/backfill-lecture-progress-scope.ts --apply    # write
 *
 * Idempotent. Safe to re-run after --apply: any legacy rows that already
 * had their per-scope copies will be skipped (the copy upsert is keyed on
 * the new unique index, so re-runs are no-ops once complete).
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { LectureProgress } from "../src/models/customer/LectureProgress.model";

const APPLY = process.argv.includes("--apply");

async function dropLegacyUniqueIndexes() {
  const coll = LectureProgress.collection;
  const existing = await coll.indexes();
  // The pre-change indexes were named by Mongo's defaults — find them by
  // key shape rather than name to be robust across environments.
  const legacyKeys = [
    JSON.stringify({ customerId: 1, videoId: 1 }),
    JSON.stringify({ customerId: 1, liveSessionId: 1 }),
  ];
  for (const idx of existing) {
    const keyJson = JSON.stringify(idx.key);
    if (!legacyKeys.includes(keyJson)) continue;
    // The new partial-unique legacy indexes from the schema also have this
    // key shape but include a partialFilterExpression. Skip those — only
    // drop indexes WITHOUT a partialFilterExpression (the old ones).
    if ((idx as any).partialFilterExpression) continue;
    console.log(`Dropping legacy unique index: ${idx.name} (key=${keyJson})`);
    if (APPLY) await coll.dropIndex(idx.name!);
  }
}

type ScopeKind = "course" | "liveCourse" | "package";

interface LegacyRow {
  _id: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  videoId?: mongoose.Types.ObjectId | null;
  liveSessionId?: mongoose.Types.ObjectId | null;
  courseId?: mongoose.Types.ObjectId | null;
  liveCourseId?: mongoose.Types.ObjectId | null;
  packageId?: mongoose.Types.ObjectId | null;
  positionSec: number;
  durationSec: number;
  completed: boolean;
  completedAt?: Date | null;
  lastWatchedAt: Date;
}

function scopesFor(row: LegacyRow): Array<{ kind: ScopeKind; id: mongoose.Types.ObjectId }> {
  const out: Array<{ kind: ScopeKind; id: mongoose.Types.ObjectId }> = [];
  if (row.courseId)     out.push({ kind: "course",     id: row.courseId });
  if (row.liveCourseId) out.push({ kind: "liveCourse", id: row.liveCourseId });
  if (row.packageId)    out.push({ kind: "package",    id: row.packageId });
  return out;
}

async function main() {
  await connectDB();
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"}`);

  await dropLegacyUniqueIndexes();

  if (APPLY) {
    // Build the new partial-unique indexes declared on the schema.
    console.log("Ensuring new indexes…");
    await LectureProgress.syncIndexes();
  }

  const cursor = LectureProgress.find({
    $or: [{ scopeKind: null }, { scopeKind: { $exists: false } }],
  })
    .lean<LegacyRow>()
    .cursor();

  let scanned = 0;
  let fannedOut = 0;
  let copiesWritten = 0;
  let deleted = 0;
  let skippedNoScope = 0;

  for await (const row of cursor as any) {
    scanned++;
    const scopes = scopesFor(row);
    if (scopes.length === 0) {
      // No parent pointer at all — nothing to fan out. Leave the legacy
      // row in place; it won't appear in scope-filtered reads but also
      // doesn't actively harm anything.
      skippedNoScope++;
      continue;
    }

    for (const s of scopes) {
      const filter: any = {
        customerId: row.customerId,
        scopeKind: s.kind,
      };
      if (row.videoId)       filter.videoId       = row.videoId;
      if (row.liveSessionId) filter.liveSessionId = row.liveSessionId;
      if (s.kind === "course")     filter.courseId     = s.id;
      if (s.kind === "liveCourse") filter.liveCourseId = s.id;
      if (s.kind === "package")    filter.packageId    = s.id;

      const update: any = {
        $set: {
          positionSec: row.positionSec,
          durationSec: row.durationSec,
          lastWatchedAt: row.lastWatchedAt,
          scopeKind: s.kind,
          courseId:     s.kind === "course"     ? s.id : null,
          liveCourseId: s.kind === "liveCourse" ? s.id : null,
          packageId:    s.kind === "package"    ? s.id : null,
        },
        $setOnInsert: {
          customerId: row.customerId,
          videoId:       row.videoId       ?? null,
          liveSessionId: row.liveSessionId ?? null,
        },
      };
      if (row.completed) {
        update.$set.completed = true;
        update.$set.completedAt = row.completedAt ?? row.lastWatchedAt;
      }

      if (APPLY) {
        await LectureProgress.updateOne(filter, update, { upsert: true });
      }
      copiesWritten++;
    }

    if (APPLY) {
      await LectureProgress.deleteOne({ _id: row._id });
    }
    fannedOut++;
    deleted++;

    if (scanned % 500 === 0) {
      console.log(`  …${scanned} scanned, ${copiesWritten} copies written so far`);
    }
  }

  console.log("---");
  console.log(`Scanned legacy rows:    ${scanned}`);
  console.log(`Fanned out:             ${fannedOut}`);
  console.log(`Per-scope copies:       ${copiesWritten}`);
  console.log(`Legacy rows deleted:    ${deleted}`);
  console.log(`Skipped (no scope):     ${skippedNoScope}`);
  if (!APPLY) console.log("\n(Dry-run only. Re-run with --apply to write.)");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
