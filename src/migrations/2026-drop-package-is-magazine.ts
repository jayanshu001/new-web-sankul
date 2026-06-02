/**
 * One-shot migration: remove the deprecated `isMagazine` field from the Package
 * module.
 *
 * 1. $unset `isMagazine` on every ws_packages document so no stale data remains.
 * 2. Flush admin package caches (`admin:package:list:*` and
 *    `admin:package:detail:*`) so no in-flight cached payload still carries the
 *    removed `isMagazine` field after deploy.
 *
 * Scope: Package only. `isMagazine` is still in use on Books (ws_books,
 * ws_book_orders) — those collections are intentionally left untouched.
 *
 * Forward-only — no down migration. Idempotent: re-running is a no-op once the
 * field is gone from every document.
 *
 * Usage:
 *
 *     import { runDropPackageIsMagazineMigration } from "./migrations/2026-drop-package-is-magazine";
 *     await runDropPackageIsMagazineMigration();
 *
 *     // Or directly via tsx, pointing MONGODB_URI at the target DB
 *     // (tsx is required over ts-node because package.json sets
 *     //  "type": "module" while the codebase imports CommonJS-style):
 *     MONGODB_URI="<env-uri>" npx tsx src/migrations/2026-drop-package-is-magazine.ts
 */

import "dotenv/config";
import mongoose from "mongoose";
import cache from "../libs/cache";

interface MigrationStats {
  packagesUpdated: number;
  cacheKeysFlushed: number;
}

export async function runDropPackageIsMagazineMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const stats: MigrationStats = {
    packagesUpdated: 0,
    cacheKeysFlushed: 0,
  };

  // 1. $unset isMagazine on every Package document.
  const packages = db.collection("ws_packages");
  const unsetResult = await packages.updateMany(
    { isMagazine: { $exists: true } },
    { $unset: { isMagazine: "" } }
  );
  stats.packagesUpdated = unsetResult.modifiedCount;

  // 2. Flush admin package caches so no stale payload still carries isMagazine.
  const [listFlushed, detailFlushed] = await Promise.all([
    cache.invalidateByPrefix(cache.keyPrefix("admin", "package", "list:")),
    cache.invalidateByPrefix(cache.keyPrefix("admin", "package", "detail:")),
  ]);
  stats.cacheKeysFlushed = (listFlushed ?? 0) + (detailFlushed ?? 0);

  return stats;
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
    const stats = await runDropPackageIsMagazineMigration();
    console.log("Drop package isMagazine migration complete:", stats);
  } finally {
    await mongoose.disconnect();
  }
  // Importing ../libs/cache opens an ioredis client that keeps the event loop
  // alive, so exit explicitly instead of letting the process hang post-run.
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
