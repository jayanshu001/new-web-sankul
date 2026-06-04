/**
 * One-shot migration: fix the ws_books text index so saving a Book with a
 * non-English `language` value (e.g. "Gujarati") no longer fails with
 * "Plan executor error during findAndModify :: caused by ::
 *  language override unsupported: Gujarati".
 *
 * Root cause: the existing text index was created as
 *   { name: "text", author: "text" }            // default options
 * which Mongo materialises with `language_override: "language"`. That makes
 * Mongo read each document's `language` field as its per-document text-search
 * language. The Book's `language` field is plain display metadata ("Gujarati",
 * "Hindi", …) — not a Mongo text-search language — so every insert/update is
 * rejected.
 *
 * Fix: drop the old text index and recreate it with the field decoupled:
 *   { default_language: "none", language_override: "_none" }
 * (`_none` is a field that doesn't exist on the document, so the metadata
 * `language` is ignored by the index.) This matches the Ebook model's index.
 *
 * The schema change in Book.model.ts covers fresh databases (autoIndex); this
 * migration is needed for any DB where the old index already exists, because
 * Mongo will not redefine an existing index from a changed schema definition.
 *
 * Forward-only. Idempotent: re-running drops + recreates with the same options.
 *
 * Usage:
 *     MONGODB_URI="<env-uri>" npx tsx src/migrations/2026-book-text-index-language-override.ts
 */

import "dotenv/config";
import mongoose from "mongoose";

interface MigrationStats {
  oldIndexDropped: boolean;
  newIndexCreated: string;
}

const TEXT_INDEX_NAME = "name_text_author_text";

export async function runBookTextIndexMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const books = db.collection("ws_books");
  const stats: MigrationStats = { oldIndexDropped: false, newIndexCreated: "" };

  // Drop the existing text index if present (it carries language_override:"language").
  try {
    await books.dropIndex(TEXT_INDEX_NAME);
    stats.oldIndexDropped = true;
  } catch (err: any) {
    // IndexNotFound (code 27) — nothing to drop, fine. Anything else: rethrow.
    if (err?.codeName !== "IndexNotFound" && err?.code !== 27) throw err;
  }

  // Recreate with the metadata `language` field decoupled from the text index.
  stats.newIndexCreated = await books.createIndex(
    { name: "text", author: "text" },
    { name: TEXT_INDEX_NAME, default_language: "none", language_override: "_none" }
  );

  return stats;
}

// One-shot script — invoked directly via `npx tsx`, never imported by the app.
// Run unconditionally (the CommonJS require.main guard fails under ESM).
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    const stats = await runBookTextIndexMigration();
    console.log("Book text-index language-override migration complete:", stats);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
