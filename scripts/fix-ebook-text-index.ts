/**
 * One-shot: rebuild the text index on ws_ebooks.
 *
 * The text index on { author, name } must use default_language: "none" and
 * language_override: "_none" — otherwise Mongo reads the document's `language`
 * field (e.g. "Gujarati") as a stemmer language and fails with
 *   "language override unsupported: Gujarati".
 *
 * On environments where the index was created earlier without those options,
 * Mongoose will NOT recreate it (option drift is not auto-fixed). This script
 * drops any existing text index and rebuilds from the current schema.
 *
 * Idempotent. Safe to re-run.
 *
 * Usage (from repo root):
 *   npx tsx scripts/fix-ebook-text-index.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { Ebook } from "../src/models/ebook/Ebook.model";

async function main() {
  await connectDB();
  const coll = Ebook.collection;

  const indexes = await coll.indexes();
  const textIndexes = indexes.filter(
    (i) => i.key && Object.values(i.key).includes("text")
  );

  for (const idx of textIndexes) {
    if (!idx.name) continue;
    console.log("Dropping text index:", idx.name, JSON.stringify(idx.key));
    await coll.dropIndex(idx.name);
  }
  if (textIndexes.length === 0) {
    console.log("No existing text index found — nothing to drop.");
  }

  console.log("Rebuilding indexes from current schema…");
  await Ebook.syncIndexes();

  const after = await coll.indexes();
  console.log("Indexes now on ws_ebooks:");
  for (const idx of after) {
    console.log(
      " ",
      idx.name,
      JSON.stringify(idx.key),
      idx.default_language ? `default_language=${idx.default_language}` : "",
      idx.language_override ? `language_override=${idx.language_override}` : ""
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Fix failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
