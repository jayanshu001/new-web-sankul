/**
 * One-shot migration: remove the LiveCourseCategory feature.
 *
 * 1. $unset `liveCourseCategoryId` on every LiveCourse document.
 * 2. Drop the `ws_live_course_categories` collection.
 * 3. Delete RBAC permission rows whose `name` starts with
 *    `live-course-categories.` and pull those permission ids from every Role.
 * 4. Flush cache prefixes `admin:live-course:list:*` and
 *    `admin:live-course:detail:*` so no in-flight cached payload still carries
 *    the removed `liveCourseCategoryId` field after deploy.
 *
 * Forward-only — no down migration. Idempotent: re-running is a no-op once the
 * collection is gone and no permissions match.
 *
 * Usage:
 *
 *     import { runDropLiveCourseCategoriesMigration } from "./migrations/2026-drop-live-course-categories";
 *     await runDropLiveCourseCategoriesMigration();
 *
 *     // Or directly via ts-node, pointing MONGODB_URI at the target DB:
 *     npx ts-node -T src/migrations/2026-drop-live-course-categories.ts
 */

import mongoose from "mongoose";
import cache from "../libs/cache";

interface MigrationStats {
  liveCoursesUpdated: number;
  collectionDropped: boolean;
  permissionsDeleted: number;
  rolesUpdated: number;
  cacheKeysFlushed: number;
}

export async function runDropLiveCourseCategoriesMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const stats: MigrationStats = {
    liveCoursesUpdated: 0,
    collectionDropped: false,
    permissionsDeleted: 0,
    rolesUpdated: 0,
    cacheKeysFlushed: 0,
  };

  // 1. $unset liveCourseCategoryId on every LiveCourse.
  const liveCourses = db.collection("ws_live_courses");
  const unsetResult = await liveCourses.updateMany(
    { liveCourseCategoryId: { $exists: true } },
    { $unset: { liveCourseCategoryId: "" } }
  );
  stats.liveCoursesUpdated = unsetResult.modifiedCount;

  // 2. Drop the collection (ignore "ns not found" so it's idempotent).
  try {
    await db.dropCollection("ws_live_course_categories");
    stats.collectionDropped = true;
  } catch (err: any) {
    if (err?.codeName !== "NamespaceNotFound" && err?.code !== 26) {
      throw err;
    }
  }

  // 3. RBAC: find permission ids, $pull from roles, then delete.
  const permissions = db.collection("ws_permissions");
  const roles = db.collection("ws_roles");

  const matching = await permissions
    .find(
      { name: { $regex: "^live-course-categories\\." } },
      { projection: { _id: 1 } }
    )
    .toArray();
  const ids = matching.map((p) => p._id);

  if (ids.length > 0) {
    const rolesResult = await roles.updateMany(
      { permissions: { $in: ids } },
      { $pull: { permissions: { $in: ids } } } as any
    );
    stats.rolesUpdated = rolesResult.modifiedCount;

    const delResult = await permissions.deleteMany({ _id: { $in: ids } });
    stats.permissionsDeleted = delResult.deletedCount ?? 0;
  }

  // 4. Flush admin live-course caches so no stale populated payload survives.
  const [listFlushed, detailFlushed] = await Promise.all([
    cache.invalidateByPrefix(cache.key("admin", "live-course", "list:")),
    cache.invalidateByPrefix(cache.key("admin", "live-course", "detail:")),
  ]);
  stats.cacheKeysFlushed = (listFlushed ?? 0) + (detailFlushed ?? 0);

  return stats;
}

if (require.main === module) {
  (async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error("MONGODB_URI is required.");
      process.exit(1);
    }
    await mongoose.connect(uri);
    try {
      const stats = await runDropLiveCourseCategoriesMigration();
      console.log("Drop live-course-categories migration complete:", stats);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
