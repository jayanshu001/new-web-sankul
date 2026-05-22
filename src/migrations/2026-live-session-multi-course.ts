/**
 * One-shot migration: backfill `LiveSession.liveCourseIds` from the legacy
 * single `liveCourseId` field.
 *
 * Background: a LiveSession used to belong to exactly one LiveCourse via
 * `liveCourseId`. The schema now uses `liveCourseIds: ObjectId[]` so a session
 * can be broadcast to multiple courses simultaneously. This migration copies
 * the old single id into the new array for every legacy document.
 *
 * Usage:
 *
 *     // From application code with an open Mongo connection:
 *     import { runLiveSessionMultiCourseMigration } from "./migrations/2026-live-session-multi-course";
 *     await runLiveSessionMultiCourseMigration();
 *
 *     // Or directly via ts-node, pointing MONGODB_URI at the target DB:
 *     npx ts-node -T src/migrations/2026-live-session-multi-course.ts
 *
 * Idempotent — safe to re-run. A session that already has a non-empty
 * `liveCourseIds` is skipped.
 */

import mongoose from "mongoose";

interface MigrationStats {
  scanned: number;
  backfilled: number;
  alreadyMigrated: number;
  noLegacyId: number;
}

export async function runLiveSessionMultiCourseMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const coll = db.collection("ws_live_sessions");

  const stats: MigrationStats = {
    scanned: 0,
    backfilled: 0,
    alreadyMigrated: 0,
    noLegacyId: 0,
  };

  // Stream over every session — bypass mongoose so deprecated `liveCourseId`
  // is still readable even though the model no longer declares it.
  const cursor = coll.find({}, { projection: { _id: 1, liveCourseId: 1, liveCourseIds: 1 } });

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) break;
    stats.scanned += 1;

    const existing = Array.isArray(doc.liveCourseIds) ? doc.liveCourseIds : [];
    if (existing.length > 0) {
      stats.alreadyMigrated += 1;
      continue;
    }

    const legacy = doc.liveCourseId;
    if (!legacy) {
      stats.noLegacyId += 1;
      continue;
    }

    await coll.updateOne(
      { _id: doc._id },
      { $set: { liveCourseIds: [legacy] } }
    );
    stats.backfilled += 1;
  }

  return stats;
}

// Allow direct execution: `npx ts-node -T src/migrations/2026-live-session-multi-course.ts`
if (require.main === module) {
  (async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error("MONGODB_URI is required.");
      process.exit(1);
    }
    await mongoose.connect(uri);
    try {
      const stats = await runLiveSessionMultiCourseMigration();
      console.log("LiveSession multi-course migration complete:", stats);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
