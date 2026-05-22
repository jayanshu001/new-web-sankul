/**
 * One-shot migration: restructure LiveCourse schedule + remove timetable.
 *
 * 1. For every LiveCourse with a non-empty legacy `scheduleEntries` and no
 *    `scheduleFolders` yet: create one "General" folder containing those
 *    entries (preserving original order, re-indexed 0..n) and push it onto
 *    `scheduleFolders`. Then $unset `scheduleEntries`.
 * 2. For every LiveCourse: $unset `timetableFiles`.
 *
 * Idempotent: skips courses that already have `scheduleFolders` and is a no-op
 * for unsets if the field is already absent.
 *
 * Usage:
 *
 *     // From application code with an open Mongo connection:
 *     import { runLiveCourseScheduleFoldersMigration } from "./migrations/2026-live-course-schedule-folders";
 *     await runLiveCourseScheduleFoldersMigration();
 *
 *     // Or directly via ts-node, pointing MONGODB_URI at the target DB:
 *     npx ts-node -T src/migrations/2026-live-course-schedule-folders.ts
 */

import mongoose from "mongoose";

interface MigrationStats {
  scanned: number;
  convertedToFolder: number;
  alreadyHadFolders: number;
  noLegacyEntries: number;
  timetableUnset: number;
}

export async function runLiveCourseScheduleFoldersMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const coll = db.collection("ws_live_courses");
  const stats: MigrationStats = {
    scanned: 0,
    convertedToFolder: 0,
    alreadyHadFolders: 0,
    noLegacyEntries: 0,
    timetableUnset: 0,
  };

  // Pass 1: scheduleEntries → scheduleFolders[0]
  const cursor = coll.find(
    {},
    { projection: { _id: 1, scheduleEntries: 1, scheduleFolders: 1 } }
  );
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) break;
    stats.scanned += 1;

    const folders = Array.isArray(doc.scheduleFolders) ? doc.scheduleFolders : [];
    if (folders.length > 0) {
      stats.alreadyHadFolders += 1;
      // Still ensure the legacy fields are cleared for this doc.
      await coll.updateOne(
        { _id: doc._id },
        { $unset: { scheduleEntries: "", timetableFiles: "" } }
      );
      continue;
    }

    const legacy = Array.isArray(doc.scheduleEntries) ? doc.scheduleEntries : [];
    if (legacy.length === 0) {
      stats.noLegacyEntries += 1;
      await coll.updateOne(
        { _id: doc._id },
        { $unset: { scheduleEntries: "", timetableFiles: "" } }
      );
      continue;
    }

    const sortedEntries = [...legacy]
      .sort(
        (a: any, b: any) =>
          ((a.order ?? 0) - (b.order ?? 0)) ||
          (new Date(a.date).getTime() - new Date(b.date).getTime())
      )
      .map((e: any, idx: number) => ({
        _id: new mongoose.Types.ObjectId(),
        date: e.date instanceof Date ? e.date : new Date(e.date),
        subject: String(e.subject ?? ""),
        time: String(e.time ?? ""),
        order: idx,
      }));

    const folder = {
      _id: new mongoose.Types.ObjectId(),
      title: "General",
      image: null,
      order: 0,
      status: true,
      entries: sortedEntries,
    };

    await coll.updateOne(
      { _id: doc._id },
      {
        $set: { scheduleFolders: [folder] },
        $unset: { scheduleEntries: "", timetableFiles: "" },
      }
    );
    stats.convertedToFolder += 1;
  }

  // Pass 2: ensure timetableFiles is gone everywhere (idempotent sweep).
  const sweep = await coll.updateMany(
    { timetableFiles: { $exists: true } },
    { $unset: { timetableFiles: "" } }
  );
  stats.timetableUnset = sweep.modifiedCount;

  return stats;
}

if (require.main === module) {
  (async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error("MONGODB_URI is required.");
      process.exit(1);
    }
    await mongoose.connect(uri);
    try {
      const stats = await runLiveCourseScheduleFoldersMigration();
      console.log("LiveCourse schedule-folders migration complete:", stats);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
