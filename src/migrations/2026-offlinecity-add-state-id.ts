/**
 * One-shot migration: ensure `stateId` exists on every OfflineCity, and REPORT
 * which cities still need a state assigned.
 *
 * `OfflineCity` gained a `stateId` ref (→ CustomerState) so the client can fetch
 * cities by state (`GET /address/cities?stateId=<id>`). Cities created before the
 * field have no `stateId`, so a `{ stateId }` filter does NOT match them and they
 * vanish from the state-scoped dropdown.
 *
 * This migration:
 *   1. Sets `stateId: null` on any city where the field is absent, so the field
 *      is always present (matches the schema default) — safe & idempotent.
 *   2. Does NOT guess a city → state mapping. There is no source of truth for it
 *      in the DB, so it must be assigned by an admin (via PUT /admin/address/cities/:id
 *      with `stateId`, or set in the admin UI). The migration LISTS every city that
 *      still has no state so you know exactly what to fill in.
 *
 * Optionally pass a JSON map via the CITY_STATE_MAP env var to backfill in bulk:
 *   CITY_STATE_MAP='{"<cityId>":"<stateId>", ...}'
 * Only entries whose city currently has no stateId are applied.
 *
 * Forward-only. Idempotent. No down migration.
 *
 * Usage:
 *   MONGODB_URI="<uri>" npx tsx src/migrations/2026-offlinecity-add-state-id.ts
 *   CITY_STATE_MAP='{"6a..":"6b.."}' MONGODB_URI="<uri>" npx tsx src/migrations/2026-offlinecity-add-state-id.ts
 */

import "dotenv/config";
import mongoose from "mongoose";

interface MigrationStats {
  defaultedToNull: number;
  backfilledFromMap: number;
  stillMissingState: number;
}

export async function runOfflineCityAddStateIdMigration(
  cityStateMap: Record<string, string> = {}
): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const cities = db.collection("ws_offline_city");

  // 1. Ensure the field exists everywhere.
  const defaulted = await cities.updateMany(
    { stateId: { $exists: false } },
    { $set: { stateId: null } }
  );

  // 2. Optional bulk backfill from a provided map (only fills empty ones).
  let backfilled = 0;
  for (const [cityId, stateId] of Object.entries(cityStateMap)) {
    if (!mongoose.Types.ObjectId.isValid(cityId) || !mongoose.Types.ObjectId.isValid(stateId)) {
      console.warn(`[skip] invalid id pair city=${cityId} state=${stateId}`);
      continue;
    }
    const r = await cities.updateOne(
      { _id: new mongoose.Types.ObjectId(cityId), $or: [{ stateId: null }, { stateId: { $exists: false } }] },
      { $set: { stateId: new mongoose.Types.ObjectId(stateId) } }
    );
    backfilled += r.modifiedCount;
  }

  // 3. Report cities still missing a state — these won't appear under any
  //    ?stateId= filter until an admin assigns one.
  const missing = await cities
    .find({ $or: [{ stateId: null }, { stateId: { $exists: false } }] })
    .project({ _id: 1, name: 1 })
    .toArray();

  if (missing.length) {
    console.log(`\n⚠️  ${missing.length} city/cities still have NO state assigned:`);
    for (const c of missing) console.log(`   - ${String(c._id)}  ${c.name}`);
    console.log(
      "\nAssign each via PUT /admin/address/cities/:id { stateId } (or the admin UI), " +
        "or re-run with CITY_STATE_MAP set.\n"
    );
  }

  return {
    defaultedToNull: defaulted.modifiedCount,
    backfilledFromMap: backfilled,
    stillMissingState: missing.length,
  };
}

// One-shot script — invoked directly via `npx tsx`, never imported by the app.
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }
  let map: Record<string, string> = {};
  if (process.env.CITY_STATE_MAP) {
    try {
      map = JSON.parse(process.env.CITY_STATE_MAP);
    } catch {
      console.error("CITY_STATE_MAP must be valid JSON.");
      process.exit(1);
    }
  }
  await mongoose.connect(uri);
  try {
    const stats = await runOfflineCityAddStateIdMigration(map);
    console.log("OfflineCity stateId migration complete:", stats);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
