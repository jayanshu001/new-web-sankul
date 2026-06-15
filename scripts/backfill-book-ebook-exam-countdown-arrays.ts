/**
 * One-shot backfill: seed the new multi-select examCountdownCategoryIds[] on
 * legacy Books and Ebooks from the deprecated single examCountdownCategoryId.
 *
 * Why: the admin panel and the client category endpoint
 * (GET /client/exam-countdown-categories/:id/books-ebooks) now read the
 * examCountdownCategoryIds[] ARRAY. Legacy rows have the single
 * examCountdownCategoryId set but an empty array, so without this backfill they
 * would disappear from that screen until re-saved. This copies the single value
 * into the array (as a one-element array) for every row that has the single
 * field set and an empty/missing array.
 *
 * examCountdownIds[] is left untouched — there was never a single-field source
 * for it, so there is nothing to backfill.
 *
 * Usage (from repo root) — use tsx, NOT ts-node (the project is "type": "module"
 * with a commonjs tsconfig, which ts-node can't resolve; tsx is what `npm run dev`
 * uses):
 *   npx tsx scripts/backfill-book-ebook-exam-countdown-arrays.ts
 *
 * Idempotent. Safe to re-run (only touches rows whose array is still empty).
 * Logs counts at the end.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { Book } from "../src/models/book/Book.model";
import { Ebook } from "../src/models/ebook/Ebook.model";

// Rows that have a non-null legacy single field but no array entries yet.
const candidateFilter = {
  examCountdownCategoryId: { $ne: null },
  $or: [
    { examCountdownCategoryIds: { $exists: false } },
    { examCountdownCategoryIds: { $size: 0 } },
  ],
};

async function backfill(model: typeof Book | typeof Ebook, label: string) {
  const rows = await (model as any)
    .find(candidateFilter)
    .select("_id examCountdownCategoryId")
    .lean();

  console.log(`[${label}] Found ${rows.length} row(s) needing backfill.`);

  let updated = 0;
  for (const row of rows as any[]) {
    await (model as any).updateOne(
      { _id: row._id },
      { $set: { examCountdownCategoryIds: [row.examCountdownCategoryId] } }
    );
    updated += 1;
  }
  console.log(`[${label}] Backfill complete. Updated: ${updated}.`);
}

async function main() {
  await connectDB();
  await backfill(Book, "Book");
  await backfill(Ebook, "Ebook");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
