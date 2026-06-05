/**
 * One-shot migration: enable soft-delete on AdminUser (ws_users) and
 * CourseEducator (ws_course_educators).
 *
 * Two changes per collection:
 *
 *  1. Backfill `deleted: false` on every existing row that predates the field.
 *     Reads filter on `{ deleted: false }`, and `{ deleted: false }` does NOT
 *     match a missing field — so without this backfill every legacy admin /
 *     educator would vanish from the list, login, and uniqueness checks.
 *
 *  2. Replace the plain unique index on `email` with a PARTIAL unique index
 *     scoped to `{ deleted: false }`. This is what lets a soft-deleted admin /
 *     educator free its email for re-registration. The schema defines the new
 *     partial index (autoIndex covers fresh DBs), but Mongo will NOT redefine
 *     an existing `email_1` index from a changed schema — so on any DB where
 *     the old unique index already exists, it must be dropped here first.
 *     (Step 1 runs BEFORE the index swap so no document is missing `deleted`
 *     when the partial filter is evaluated.)
 *
 * Forward-only — no down migration. Idempotent: re-running backfills nothing
 * and drops/recreates the same partial index.
 *
 * Usage:
 *     MONGODB_URI="<env-uri>" npx tsx src/migrations/2026-soft-delete-admin-educator.ts
 */

import "dotenv/config";
import mongoose from "mongoose";

interface MigrationStats {
  adminsBackfilled: number;
  educatorsBackfilled: number;
  adminEmailIndexSwapped: boolean;
  educatorEmailIndexSwapped: boolean;
}

// Drop a legacy plain index named "email_1" if present, then (re)create the
// partial-unique index on { email: 1 } scoped to non-deleted rows.
async function swapToPartialEmailIndex(collection: any): Promise<boolean> {
  let droppedLegacy = false;
  try {
    await collection.dropIndex("email_1");
    droppedLegacy = true;
  } catch (err: any) {
    // IndexNotFound (27) — nothing to drop. Anything else: rethrow.
    if (err?.codeName !== "IndexNotFound" && err?.code !== 27) throw err;
  }

  await collection.createIndex(
    { email: 1 },
    { unique: true, partialFilterExpression: { deleted: false } }
  );
  return droppedLegacy;
}

export async function runSoftDeleteAdminEducatorMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const admins = db.collection("ws_users");
  const educators = db.collection("ws_course_educators");

  // 1) Backfill the flag first so the partial index sees `deleted` on every row.
  const [adminRes, educatorRes] = await Promise.all([
    admins.updateMany({ deleted: { $exists: false } }, { $set: { deleted: false } }),
    educators.updateMany({ deleted: { $exists: false } }, { $set: { deleted: false } }),
  ]);

  // 2) Swap each email index to the partial-unique variant.
  const adminEmailIndexSwapped = await swapToPartialEmailIndex(admins);
  const educatorEmailIndexSwapped = await swapToPartialEmailIndex(educators);

  return {
    adminsBackfilled: adminRes.modifiedCount,
    educatorsBackfilled: educatorRes.modifiedCount,
    adminEmailIndexSwapped,
    educatorEmailIndexSwapped,
  };
}

// One-shot script — invoked directly via `npx tsx`, never imported by the app
// (the exported function above is the importable entrypoint). Run unconditionally:
// the CommonJS `require.main === module` guard fails at runtime under ESM, and
// `import.meta.url` fails the CommonJS-targeted tsc build, so neither guard works
// across both. Unconditional run is safe here.
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    const stats = await runSoftDeleteAdminEducatorMigration();
    console.log("Soft-delete admin/educator migration complete:", stats);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
