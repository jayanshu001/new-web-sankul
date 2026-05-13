/**
 * One-shot: the live_sessions collection was originally created with
 * { streamId: 1 } unique (non-sparse). The schema now treats streamId as
 * optional with `unique + sparse`, so multiple SCHEDULED rows (which have
 * streamId: null until they start) need to coexist. Drop the legacy index
 * and rebuild via syncIndexes() so Mongoose recreates it with the new
 * options.
 *
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
