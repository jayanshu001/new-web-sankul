/**
 * One-shot migration: collapse per-scope LectureProgress rows back into a
 * single global row per (customer, lecture).
 *
 * Context: progress was previously fanned out into one row per
 *   (customer, videoId, scopeKind, courseId|liveCourseId|packageId)
 * so the same video reached via two containers had two independent rows.
 * We've reverted that — progress is now global per (customer, videoId)
 * and per (customer, liveSessionId). The denormalised parent pointers
 * (courseId / liveCourseId / packageId) survive on the single row as a
 * union of every container the user has been entitled under, so the
 * Resume Learning rollups still work.
 *
 * Strategy:
 *   1) drop the old per-scope partial unique indexes that block having
 *      one global row per (customer, lecture).
 *   2) ensure the new global partial unique indexes from the schema are
 *      built.
 *   3) for every (customerId, videoId) group with >1 row, merge into one:
 *        positionSec    = max
 *        durationSec    = max
 *        completed      = OR
 *        completedAt    = earliest non-null
 *        lastWatchedAt  = latest
 *        courseId       = first non-null
 *        liveCourseId   = first non-null
 *        packageId      = first non-null
 *        scopeKind      = removed
 *      Keep one row (the latest lastWatchedAt), update it with the merged
 *      values, delete the rest.
 *   4) same for (customerId, liveSessionId).
 *
 * Usage (dry-run by default — pass --apply to write):
 *   npx ts-node scripts/collapse-lecture-progress-to-global.ts
 *   npx ts-node scripts/collapse-lecture-progress-to-global.ts --apply
 *
 * Idempotent. Safe to re-run.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { LectureProgress } from "../src/models/customer/LectureProgress.model";

const APPLY = process.argv.includes("--apply");

async function dropPerScopeIndexes() {
  const coll = LectureProgress.collection;
  const existing = await coll.indexes();
  const perScopeIndexNames = [
    "uniq_customer_video_course",
    "uniq_customer_video_liveCourse",
    "uniq_customer_video_package",
    "uniq_customer_liveSession_liveCourse",
    "uniq_customer_liveSession_package",
    "uniq_customer_video_legacy",
    "uniq_customer_liveSession_legacy",
  ];
  for (const idx of existing) {
    if (idx.name && perScopeIndexNames.includes(idx.name)) {
      console.log(`  dropping index ${idx.name}`);
      if (APPLY) await coll.dropIndex(idx.name);
    }
  }
}

function pickFirstNonNull<T>(values: (T | null | undefined)[]): T | null {
  for (const v of values) if (v != null) return v as T;
  return null;
}

async function collapseGroup(
  key: { customerId: any; videoId?: any; liveSessionId?: any },
  rows: any[]
) {
  if (rows.length <= 1) {
    // Still need to strip scopeKind on lone rows (no-op if already absent).
    if (APPLY && rows[0] && (rows[0] as any).scopeKind != null) {
      await LectureProgress.collection.updateOne(
        { _id: rows[0]._id },
        { $unset: { scopeKind: "" } }
      );
    }
    return { kept: rows[0]?._id, deleted: 0 };
  }

  // Sort by lastWatchedAt desc — keep the most recent row as the survivor.
  rows.sort(
    (a, b) =>
      new Date(b.lastWatchedAt ?? 0).getTime() -
      new Date(a.lastWatchedAt ?? 0).getTime()
  );
  const survivor = rows[0];
  const losers = rows.slice(1);

  const merged: any = {
    positionSec: Math.max(...rows.map((r) => r.positionSec ?? 0)),
    durationSec: Math.max(...rows.map((r) => r.durationSec ?? 0)),
    completed: rows.some((r) => !!r.completed),
    lastWatchedAt: new Date(
      Math.max(...rows.map((r) => new Date(r.lastWatchedAt ?? 0).getTime()))
    ),
    courseId: pickFirstNonNull(rows.map((r) => r.courseId)),
    liveCourseId: pickFirstNonNull(rows.map((r) => r.liveCourseId)),
    packageId: pickFirstNonNull(rows.map((r) => r.packageId)),
  };
  const completedAts = rows
    .map((r) => r.completedAt)
    .filter((d): d is Date => !!d)
    .map((d) => new Date(d).getTime());
  merged.completedAt = completedAts.length
    ? new Date(Math.min(...completedAts))
    : null;

  if (APPLY) {
    await LectureProgress.collection.updateOne(
      { _id: survivor._id },
      { $set: merged, $unset: { scopeKind: "" } }
    );
    await LectureProgress.collection.deleteMany({
      _id: { $in: losers.map((r) => r._id) },
    });
  }
  return { kept: survivor._id, deleted: losers.length };
}

async function collapseByVideo() {
  console.log("→ collapsing (customerId, videoId) groups…");
  const cursor = LectureProgress.aggregate([
    { $match: { videoId: { $ne: null } } },
    {
      $group: {
        _id: { customerId: "$customerId", videoId: "$videoId" },
        rows: { $push: "$$ROOT" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).cursor({ batchSize: 200 });

  let groups = 0;
  let deleted = 0;
  for await (const g of cursor as any) {
    groups++;
    const r = await collapseGroup(g._id, g.rows);
    deleted += r.deleted;
    if (groups % 500 === 0) console.log(`    ${groups} groups, ${deleted} rows deleted`);
  }
  console.log(`  done: ${groups} multi-row groups, ${deleted} rows deleted`);
}

async function collapseByLiveSession() {
  console.log("→ collapsing (customerId, liveSessionId) groups…");
  const cursor = LectureProgress.aggregate([
    { $match: { liveSessionId: { $ne: null } } },
    {
      $group: {
        _id: { customerId: "$customerId", liveSessionId: "$liveSessionId" },
        rows: { $push: "$$ROOT" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).cursor({ batchSize: 200 });

  let groups = 0;
  let deleted = 0;
  for await (const g of cursor as any) {
    groups++;
    const r = await collapseGroup(g._id, g.rows);
    deleted += r.deleted;
    if (groups % 500 === 0) console.log(`    ${groups} groups, ${deleted} rows deleted`);
  }
  console.log(`  done: ${groups} multi-row groups, ${deleted} rows deleted`);
}

async function stripScopeKindOnAll() {
  console.log("→ stripping scopeKind from remaining rows…");
  if (APPLY) {
    const res = await LectureProgress.collection.updateMany(
      { scopeKind: { $exists: true } },
      { $unset: { scopeKind: "" } }
    );
    console.log(`  unset on ${res.modifiedCount} rows`);
  } else {
    const n = await LectureProgress.collection.countDocuments({
      scopeKind: { $exists: true },
    });
    console.log(`  ${n} rows would be touched`);
  }
}

async function ensureNewIndexes() {
  console.log("→ syncing new global indexes from schema…");
  if (APPLY) await LectureProgress.syncIndexes();
  else console.log("  (skipped in dry-run)");
}

(async () => {
  await connectDB();
  console.log(`mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN"}\n`);
  await dropPerScopeIndexes();
  await collapseByVideo();
  await collapseByLiveSession();
  await stripScopeKindOnAll();
  await ensureNewIndexes();
  console.log("\ndone.");
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
