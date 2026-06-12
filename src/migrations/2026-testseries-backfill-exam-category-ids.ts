/**
 * One-shot migration: backfill `examCategoryIds` (array) on TestSeries from the
 * legacy single `examCategoryId` field.
 *
 * TestSeries moved from a single `examCategoryId: ObjectId` to a multi-value
 * `examCategoryIds: [ObjectId]`. Existing documents only carry the singular
 * field, so any query against `examCategoryIds` (e.g. the admin category filter,
 * which now uses `$in`) would miss them until they're backfilled.
 *
 * This sets `examCategoryIds = [examCategoryId]` for every series that has a
 * non-null `examCategoryId` but no (or empty) `examCategoryIds`. Series with no
 * legacy category get `examCategoryIds: []` so the field is always present and
 * matches the schema default.
 *
 * The legacy `examCategoryId` field is intentionally LEFT IN PLACE — controllers
 * keep it in sync during the migration window so old readers stay correct. Drop
 * it (and this script) once every reader/writer uses `examCategoryIds`.
 *
 * Forward-only — no down migration. Idempotent: re-running is a no-op once every
 * document has been backfilled.
 *
 * Usage:
 *
 *     import { runTestSeriesBackfillExamCategoryIdsMigration } from "./migrations/2026-testseries-backfill-exam-category-ids";
 *     await runTestSeriesBackfillExamCategoryIdsMigration();
 *
 *     // Or directly via tsx, pointing MONGODB_URI at the target DB:
 *     MONGODB_URI="<env-uri>" npx tsx src/migrations/2026-testseries-backfill-exam-category-ids.ts
 */

import "dotenv/config";
import mongoose from "mongoose";

interface MigrationStats {
  backfilledFromSingle: number;
  defaultedToEmpty: number;
}

export async function runTestSeriesBackfillExamCategoryIdsMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const series = db.collection("ws_test_series");

  // 1) Series with a legacy single category but no usable array → copy it across.
  const fromSingle = await series.updateMany(
    {
      examCategoryId: { $nin: [null, undefined] },
      $or: [{ examCategoryIds: { $exists: false } }, { examCategoryIds: { $size: 0 } }],
    },
    [{ $set: { examCategoryIds: ["$examCategoryId"] } }] // pipeline update: reference the existing field
  );

  // 2) Series with neither (or an absent array and no legacy id) → ensure [].
  const toEmpty = await series.updateMany(
    { examCategoryIds: { $exists: false } },
    { $set: { examCategoryIds: [] } }
  );

  return {
    backfilledFromSingle: fromSingle.modifiedCount,
    defaultedToEmpty: toEmpty.modifiedCount,
  };
}

// One-shot script — invoked directly via `npx tsx`, never imported by the app
// (the exported function above is the importable entrypoint). Run unconditionally:
// the CommonJS `require.main === module` guard fails at runtime under ESM
// ("type": "module"), and `import.meta.url` fails the CommonJS-targeted tsc build,
// so neither guard works across both. Unconditional run is safe here.
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    const stats = await runTestSeriesBackfillExamCategoryIdsMigration();
    console.log("TestSeries examCategoryIds backfill complete:", stats);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
