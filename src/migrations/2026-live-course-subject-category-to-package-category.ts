/**
 * One-shot migration: switch LiveCourse from `courseSubjectCategoryId`
 * (ref CourseSubjectCategory) to `packageCategoryId` (ref PackageCategory).
 *
 * 1. $unset `courseSubjectCategoryId` on every LiveCourse document. No
 *    best-effort backfill — there is no mapping between subject categories
 *    and package categories, so existing rows are left with packageCategoryId
 *    null for admins to set explicitly.
 * 2. Drop the now-stale index on `courseSubjectCategoryId` if one was created.
 * 3. Flush `admin:live-course:list:*` and `admin:live-course:detail:*` so no
 *    cached payload still carries the removed field.
 *
 * Forward-only — no down migration. Idempotent.
 *
 * Note: the regular Course collection still uses courseSubjectCategoryId.
 * This migration ONLY touches ws_live_courses.
 *
 * Usage:
 *
 *     import { runLiveCourseSubjectToPackageCategoryMigration } from
 *       "./migrations/2026-live-course-subject-category-to-package-category";
 *     await runLiveCourseSubjectToPackageCategoryMigration();
 *
 *     npx ts-node -T src/migrations/2026-live-course-subject-category-to-package-category.ts
 */

import mongoose from "mongoose";
import cache from "../libs/cache";

interface MigrationStats {
  liveCoursesUpdated: number;
  indexDropped: boolean;
  cacheKeysFlushed: number;
}

export async function runLiveCourseSubjectToPackageCategoryMigration(): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const stats: MigrationStats = {
    liveCoursesUpdated: 0,
    indexDropped: false,
    cacheKeysFlushed: 0,
  };

  const liveCourses = db.collection("ws_live_courses");

  const unsetResult = await liveCourses.updateMany(
    { courseSubjectCategoryId: { $exists: true } },
    { $unset: { courseSubjectCategoryId: "" } }
  );
  stats.liveCoursesUpdated = unsetResult.modifiedCount;

  try {
    await liveCourses.dropIndex("courseSubjectCategoryId_1");
    stats.indexDropped = true;
  } catch (err: any) {
    if (err?.codeName !== "IndexNotFound" && err?.code !== 27) {
      throw err;
    }
  }

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
      const stats = await runLiveCourseSubjectToPackageCategoryMigration();
      console.log("LiveCourse subject→package category migration complete:", stats);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
