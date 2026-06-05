/**
 * One-shot migration: backfill `isPaid` on Ebook documents that predate the
 * field.
 *
 * The `isPaid` field was added to the Ebook model (schema default true) to mark
 * ebooks as paid/free, matching the frontend default and the Course.isPaid
 * convention. Documents created before the field existed simply don't carry it.
 * A query like `{ isPaid: true }` does NOT match a missing field, so legacy
 * ebooks would be excluded from any future "paid" query and ambiguous to the FE.
 *
 * This sets `isPaid: true` on every ebook where the field is absent, which
 * matches the schema default. Ebooks an admin later marks free (isPaid:false)
 * are unaffected — this only touches documents missing the field entirely.
 *
 * NOTE the default differs from the Material backfill: ebooks default to PAID
 * (true), materials defaulted to FREE (false).
 *
 * Forward-only — no down migration. Idempotent: re-running is a no-op once every
 * document has the field.
 *
 * Usage:
 *
 *     import { runEbookBackfillIsPaidMigration } from "./migrations/2026-ebook-backfill-is-paid";
 *     await runEbookBackfillIsPaidMigration();
 *
 *     // Or directly via tsx, pointing MONGODB_URI at the target DB:
 *     MONGODB_URI="<env-uri>" npx tsx src/migrations/2026-ebook-backfill-is-paid.ts
 */

import "dotenv/config";
import mongoose from "mongoose";

interface MigrationStats {
  ebooksUpdated: number;
}

export async function runEbookBackfillIsPaidMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const ebooks = db.collection("ws_ebooks");

  const result = await ebooks.updateMany(
    { isPaid: { $exists: false } },
    { $set: { isPaid: true } }
  );

  return { ebooksUpdated: result.modifiedCount };
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
    const stats = await runEbookBackfillIsPaidMigration();
    console.log("Ebook isPaid backfill complete:", stats);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
