/**
 * One-shot: rebuild the unique { streamId: 1 } index on ws_live_sessions.
 *
 * The index uses a partialFilterExpression so SCHEDULED rows (streamId: null)
 * can coexist. The filter's `$type` changed from "number" to "string" when we
 * learned the real Streamos account returns streamId as a STRING — so the old
 * index must be dropped and rebuilt from the current schema.
 *
 * Drops the legacy `streamId_1` index and rebuilds via syncIndexes().
 * Idempotent. Safe to re-run — dropping a non-existent index is a no-op.
 *
 * Usage (from repo root):
 *   npx tsx scripts/fix-live-session-streamid-index.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { LiveSession } from "../src/models/course/LiveSession.model";

async function main() {
  await connectDB();
  const coll = LiveSession.collection;

  const indexes = await coll.indexes();
  const offending = indexes.find((i) => i.name === "streamId_1");
  if (offending) {
    console.log("Dropping legacy index:", offending);
    await coll.dropIndex("streamId_1");
  } else {
    console.log("No legacy streamId_1 index found — nothing to drop.");
  }

  console.log("Rebuilding indexes from current schema…");
  await LiveSession.syncIndexes();

  const after = await coll.indexes();
  console.log("Indexes now on ws_live_sessions:");
  for (const idx of after) {
    console.log(" ", idx.name, JSON.stringify(idx.key), idx.unique ? "(unique)" : "", idx.sparse ? "(sparse)" : "");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Fix failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
