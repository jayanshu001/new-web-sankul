/**
 * One-shot migration: backfill `isPaid` on Material documents that predate the
 * field.
 *
 * The `isPaid` field was added to the Material model (schema default false) to
 * gate paid study materials and drive the free-materials endpoints. Documents
 * created before the field existed simply don't carry it — and a query like
 * `{ isPaid: false }` does NOT match a missing field, so those legacy materials
 * became invisible to every "free" query (free-materials list, grouped
 * lessonCount, etc.).
 *
 * This sets `isPaid: false` on every material where the field is absent, which
 * matches the schema default. Materials an admin has explicitly marked paid
 * (isPaid:true) are left untouched.
 *
 * Forward-only — no down migration. Idempotent: re-running is a no-op once every
 * document has the field.
 *
 * Usage:
 *
 *     import { runMaterialBackfillIsPaidMigration } from "./migrations/2026-material-backfill-is-paid";
 *     await runMaterialBackfillIsPaidMigration();
 *
 *     // Or directly via tsx, pointing MONGODB_URI at the target DB:
 *     MONGODB_URI="<env-uri>" npx tsx src/migrations/2026-material-backfill-is-paid.ts
 */

import "dotenv/config";
import mongoose from "mongoose";

interface MigrationStats {
  materialsUpdated: number;
}

export async function runMaterialBackfillIsPaidMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const materials = db.collection("ws_materials");

  const result = await materials.updateMany(
    { isPaid: { $exists: false } },
    { $set: { isPaid: false } }
  );

  return { materialsUpdated: result.modifiedCount };
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
    const stats = await runMaterialBackfillIsPaidMigration();
    console.log("Material isPaid backfill complete:", stats);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
