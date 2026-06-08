/**
 * One-shot migration: backfill the PDF-upload status fields on Ebook documents
 * that predate them.
 *
 * The fields `bookUploadStatus` / `bookUploadProgress` / `demoUploadStatus` /
 * `demoUploadProgress` were added to the Ebook model so the admin list can show
 * each slot's uploading/processing/failed/done state across sessions + refresh.
 * Documents created before the fields existed don't carry them.
 *
 * Backfill rule (per slot): a present URL means the PDF is attached & ready, so
 *   bookUploadStatus = bookUrl ? "completed" : "none"   (progress 100 / 0)
 *   demoUploadStatus = demoUrl ? "completed" : "none"   (progress 100 / 0)
 *
 * The frontend already treats "URL present, status absent" as completed, so this
 * is a nice-to-have that makes the stored value canonical — not a blocker.
 *
 * Flushes the admin ebook list + detail caches afterwards so no stale cached
 * payload (missing the fields) is served post-deploy.
 *
 * Forward-only — no down migration. Idempotent: only touches documents missing a
 * status field, so re-running is a no-op.
 *
 * Usage:
 *
 *     import { runEbookBackfillUploadStatusMigration } from "./migrations/2026-ebook-backfill-upload-status";
 *     await runEbookBackfillUploadStatusMigration();
 *
 *     // Or directly via tsx, pointing MONGODB_URI at the target DB:
 *     MONGODB_URI="<env-uri>" npx tsx src/migrations/2026-ebook-backfill-upload-status.ts
 */

import "dotenv/config";
import mongoose from "mongoose";
import cache from "../libs/cache";

interface MigrationStats {
  bookCompleted: number;
  bookNone: number;
  demoCompleted: number;
  demoNone: number;
  cacheKeysFlushed: number;
}

export async function runEbookBackfillUploadStatusMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const ebooks = db.collection("ws_ebooks");

  // Book slot: completed where a bookUrl exists, else none. Only documents
  // missing the status field are touched (idempotent).
  const bookCompleted = await ebooks.updateMany(
    { bookUploadStatus: { $exists: false }, bookUrl: { $type: "string", $ne: "" } },
    { $set: { bookUploadStatus: "completed", bookUploadProgress: 100 } }
  );
  const bookNone = await ebooks.updateMany(
    {
      bookUploadStatus: { $exists: false },
      $or: [{ bookUrl: { $exists: false } }, { bookUrl: null }, { bookUrl: "" }],
    },
    { $set: { bookUploadStatus: "none", bookUploadProgress: 0 } }
  );

  // Demo slot: same rule.
  const demoCompleted = await ebooks.updateMany(
    { demoUploadStatus: { $exists: false }, demoUrl: { $type: "string", $ne: "" } },
    { $set: { demoUploadStatus: "completed", demoUploadProgress: 100 } }
  );
  const demoNone = await ebooks.updateMany(
    {
      demoUploadStatus: { $exists: false },
      $or: [{ demoUrl: { $exists: false } }, { demoUrl: null }, { demoUrl: "" }],
    },
    { $set: { demoUploadStatus: "none", demoUploadProgress: 0 } }
  );

  // Flush admin ebook caches so the new fields show up immediately.
  let cacheKeysFlushed = 0;
  cacheKeysFlushed += await cache.invalidateByPrefix(
    cache.keyPrefix("admin", "ebook", "list:")
  );
  cacheKeysFlushed += await cache.invalidateByPrefix(
    cache.keyPrefix("admin", "ebook", "detail:")
  );

  return {
    bookCompleted: bookCompleted.modifiedCount,
    bookNone: bookNone.modifiedCount,
    demoCompleted: demoCompleted.modifiedCount,
    demoNone: demoNone.modifiedCount,
    cacheKeysFlushed,
  };
}

// One-shot script — invoked directly via `npx tsx`, never imported by the app.
// Run unconditionally (the require.main / import.meta guards don't work across
// both the ESM runtime and the CommonJS-targeted tsc build — see the isPaid
// backfill for the same note).
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    const stats = await runEbookBackfillUploadStatusMigration();
    console.log("Ebook upload-status backfill complete:", stats);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
