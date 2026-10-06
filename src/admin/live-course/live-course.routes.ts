import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  createLiveCourse,
  reorderLiveCourses,
  listLiveCourses,
  getLiveCourseById,
  updateLiveCourse,
  deleteLiveCourse,
  toggleLiveCoursePopular,
  listSessionsForLiveCourse,
  updateScheduleEntriesDeprecated,
  listScheduleFolders,
  createScheduleFolder,
  updateScheduleFolder,
  deleteScheduleFolder,
  reorderScheduleFolders,
  listScheduleEntries,
  createScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  reorderScheduleEntries,
} from "./live-course.controller";
import {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
} from "./live-course.folder.controller";
import {
  listVideosInFolder,
  createVideoInFolder,
  createVideoFromRecording,
  getVideoInFolder,
  getLectureForAdmin,
  updateVideoInFolder,
  reorderVideosInFolder,
  deleteVideoInFolder,
} from "./live-course.video.controller";
import {
  createLiveCoursePlan,
  listLiveCoursePlans,
  getLiveCoursePlan,
  updateLiveCoursePlan,
  deleteLiveCoursePlan,
} from "./live-course.plan.controller";
import {
  listLiveCourseSubscriptions,
  getLiveCourseSubscription,
  grantLiveCourseSubscription,
  updateLiveCourseSubscription,
  deleteLiveCourseSubscription,
  exportLiveCourseSubscriptionsCsv,
  exportLiveCourseSubscriptionsExcel,
  changeLiveCourseOfSubscription,
  moveLiveCourseSubscription,
  deactivateLiveCourseSubscription,
  addLiveCourseSubscriptionDays,
  revertLiveCourseSubscriptionDeactivation,
} from "./live-course.subscription.controller";
import { validate } from "../../middlewares/validate";
import { changeLiveCourseSchema } from "./live-course.validation";
import { addDaysSchema, deactivateSubscriptionSchema, moveSubscriptionSchema, revertDeactivationSchema, subscriptionRowParamsSchema } from "../subscription/subscription.validation";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// --- Plans (declared first so they don't collide with /:id patterns) -------
// flush CacheEntity.LiveCourse — was unflushed (same gap as course/ebook plan
// CRUD, fixed the same way): a plan/price edit is invisible in every cached
// live-course-embedding read (client catalog-course/catalog-package/categories)
// until this route's flush group cascades to them — see flushGroups.ts.
router.get("/plans/:planId",                 getLiveCoursePlan);
router.put("/plans/:planId",                 autoFlushGroup(CacheEntity.LiveCourse), updateLiveCoursePlan);
router.delete("/plans/:planId",              autoFlushGroup(CacheEntity.LiveCourse), deleteLiveCoursePlan);

// --- Subscriptions (literal prefix — also declared before /:id patterns) ----
router.get("/subscriptions",                 listLiveCourseSubscriptions);
// Report exports — full filtered set, no pagination. Static paths registered
// before `/subscriptions/:subscriptionId` so they aren't matched as an id.
router.get("/subscriptions/export/csv",      exportLiveCourseSubscriptionsCsv);
router.get("/subscriptions/export/excel",    exportLiveCourseSubscriptionsExcel);
router.get("/subscriptions/:subscriptionId", getLiveCourseSubscription);
router.put("/subscriptions/:subscriptionId", updateLiveCourseSubscription);
router.delete("/subscriptions/:subscriptionId", deleteLiveCourseSubscription);
router.post(
  "/subscriptions/:subscriptionId/change-course",
  validate({ params: subscriptionRowParamsSchema, body: changeLiveCourseSchema }),
  changeLiveCourseOfSubscription
);
router.post(
  "/subscriptions/:subscriptionId/move",
  validate({ params: subscriptionRowParamsSchema, body: moveSubscriptionSchema }),
  moveLiveCourseSubscription
);
router.post(
  "/subscriptions/:subscriptionId/deactivate",
  validate({ params: subscriptionRowParamsSchema, body: deactivateSubscriptionSchema }),
  deactivateLiveCourseSubscription
);
router.post(
  "/subscriptions/:subscriptionId/add-days",
  validate({ params: subscriptionRowParamsSchema, body: addDaysSchema }),
  addLiveCourseSubscriptionDays
);
router.post(
  "/subscriptions/:subscriptionId/revert-deactivation",
  validate({ params: subscriptionRowParamsSchema, body: revertDeactivationSchema }),
  revertLiveCourseSubscriptionDeactivation
);

// --- Live course CRUD -------------------------------------------------------
// Master reads cached; every write that changes course content (CRUD, popular,
// schedule folders/entries, folder + video CRUD) flushes "live-course" (fans out
// to catalog-course/dashboard/free/categories). Subscriptions/sessions/exports
// are per-buyer/live and stay uncached; grant mutates a subscription, not catalog.
// create/update/delete ALSO flush the "material" group: they rewrite
// material_categories + the ws_material_category_live_course pivot, which the
// client materials tab (/client/catalog/live-course/:id/materials) and the
// /client/materials entitlement reads are cached on under "material", not
// "live-course". Kept route-level (not in FLUSH_GROUPS[LiveCourse]) so the
// frequent live-session writes that flush "live-course" don't wipe material caches.
router.get("/",                              cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.LiveCourse }), listLiveCourses);
router.post("/",                             uploadTo(UPLOAD_FOLDERS.liveCourse), uploadS3.single("image"), autoFlushGroup(CacheEntity.LiveCourse, CacheEntity.Material), createLiveCourse);
// Bulk drag-and-drop reorder. MUST stay above the "/:id" routes so "reorder" is
// never parsed as a course id. Flushes the cached lists like any other write.
router.post("/reorder",                      autoFlushGroup(CacheEntity.LiveCourse), reorderLiveCourses);
router.get("/:id",                           cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.LiveCourse }), getLiveCourseById);
router.put("/:id",                           uploadTo(UPLOAD_FOLDERS.liveCourse), uploadS3.single("image"), autoFlushGroup(CacheEntity.LiveCourse, CacheEntity.Material), updateLiveCourse);
router.delete("/:id",                        autoFlushGroup(CacheEntity.LiveCourse, CacheEntity.Material), deleteLiveCourse);
router.patch("/:id/popular",                 autoFlushGroup(CacheEntity.LiveCourse), toggleLiveCoursePopular);
router.get("/:id/sessions",                  listSessionsForLiveCourse);
router.get("/:id/plans",                     listLiveCoursePlans);
router.post("/:id/plans",                    autoFlushGroup(CacheEntity.LiveCourse), createLiveCoursePlan);
router.get("/:id/subscriptions",             listLiveCourseSubscriptions);
router.post("/:id/grant",                    grantLiveCourseSubscription);
// Deprecated: old flat schedule-entries PATCH → 410. Old timetable-files
// route is intentionally NOT registered → 404 from the router.
router.patch("/:id/schedule-entries",        updateScheduleEntriesDeprecated);

// --- Schedule folders + entries ---------------------------------------------
router.get   ("/:id/schedule-folders",                                            listScheduleFolders);
router.post  ("/:id/schedule-folders",                                            autoFlushGroup(CacheEntity.LiveCourse), createScheduleFolder);
router.post  ("/:id/schedule-folders/reorder",                                    autoFlushGroup(CacheEntity.LiveCourse), reorderScheduleFolders);
router.patch ("/:id/schedule-folders/:folderId",                                  autoFlushGroup(CacheEntity.LiveCourse), updateScheduleFolder);
router.delete("/:id/schedule-folders/:folderId",                                  autoFlushGroup(CacheEntity.LiveCourse), deleteScheduleFolder);
router.get   ("/:id/schedule-folders/:folderId/entries",                          listScheduleEntries);
router.post  ("/:id/schedule-folders/:folderId/entries",                          autoFlushGroup(CacheEntity.LiveCourse), createScheduleEntry);
router.post  ("/:id/schedule-folders/:folderId/entries/reorder",                  autoFlushGroup(CacheEntity.LiveCourse), reorderScheduleEntries);
router.patch ("/:id/schedule-folders/:folderId/entries/:entryId",                 autoFlushGroup(CacheEntity.LiveCourse), updateScheduleEntry);
router.delete("/:id/schedule-folders/:folderId/entries/:entryId",                 autoFlushGroup(CacheEntity.LiveCourse), deleteScheduleEntry);

// --- Folder CRUD (under a live course) --------------------------------------
router.get("/:liveCourseId/folders",                       listFolders);
router.post("/:liveCourseId/folders",                      autoFlushGroup(CacheEntity.LiveCourse), createFolder);
router.patch("/:liveCourseId/folders/:folderId",           autoFlushGroup(CacheEntity.LiveCourse), updateFolder);
router.delete("/:liveCourseId/folders/:folderId",          autoFlushGroup(CacheEntity.LiveCourse), deleteFolder);

// --- Video CRUD (under a folder) --------------------------------------------
router.get("/:liveCourseId/folders/:folderId/videos",                       listVideosInFolder);
router.post("/:liveCourseId/folders/:folderId/videos",                      autoFlushGroup(CacheEntity.LiveCourse), createVideoInFolder);
router.post("/:liveCourseId/folders/:folderId/videos/reorder",              autoFlushGroup(CacheEntity.LiveCourse), reorderVideosInFolder);
router.post("/:liveCourseId/folders/:folderId/videos/from-recording",       autoFlushGroup(CacheEntity.LiveCourse), createVideoFromRecording);
router.get("/:liveCourseId/folders/:folderId/videos/:videoId",              getVideoInFolder);
router.put("/:liveCourseId/folders/:folderId/videos/:videoId",              autoFlushGroup(CacheEntity.LiveCourse), updateVideoInFolder);
router.delete("/:liveCourseId/folders/:folderId/videos/:videoId",           autoFlushGroup(CacheEntity.LiveCourse), deleteVideoInFolder);

// --- Lecture preview (admin LectureWatch page) — uncached: fresh token per request.
router.get("/:liveCourseId/lecture/:videoId",                               getLectureForAdmin);

export default router;
