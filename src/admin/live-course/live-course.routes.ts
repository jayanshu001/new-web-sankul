import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  createLiveCourse,
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
} from "./live-course.subscription.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// --- Plans (declared first so they don't collide with /:id patterns) -------
router.get("/plans/:planId",                 getLiveCoursePlan);
router.put("/plans/:planId",                 updateLiveCoursePlan);
router.delete("/plans/:planId",              deleteLiveCoursePlan);

// --- Subscriptions (literal prefix — also declared before /:id patterns) ----
router.get("/subscriptions",                 listLiveCourseSubscriptions);
// Report exports — full filtered set, no pagination. Static paths registered
// before `/subscriptions/:subscriptionId` so they aren't matched as an id.
router.get("/subscriptions/export/csv",      exportLiveCourseSubscriptionsCsv);
router.get("/subscriptions/export/excel",    exportLiveCourseSubscriptionsExcel);
router.get("/subscriptions/:subscriptionId", getLiveCourseSubscription);
router.put("/subscriptions/:subscriptionId", updateLiveCourseSubscription);
router.delete("/subscriptions/:subscriptionId", deleteLiveCourseSubscription);

// --- Live course CRUD -------------------------------------------------------
// Master reads cached; every write that changes course content (CRUD, popular,
// schedule folders/entries, folder + video CRUD) flushes "live-course" (fans out
// to catalog-course/dashboard/free/categories). Subscriptions/sessions/exports
// are per-buyer/live and stay uncached; grant mutates a subscription, not catalog.
router.get("/",                              cacheRoute({ ttl: 86400, entity: "live-course" }), listLiveCourses);
router.post("/",                             uploadS3.single("image"), autoFlushGroup("live-course"), createLiveCourse);
router.get("/:id",                           cacheRoute({ ttl: 86400, entity: "live-course" }), getLiveCourseById);
router.put("/:id",                           uploadS3.single("image"), autoFlushGroup("live-course"), updateLiveCourse);
router.delete("/:id",                        autoFlushGroup("live-course"), deleteLiveCourse);
router.patch("/:id/popular",                 autoFlushGroup("live-course"), toggleLiveCoursePopular);
router.get("/:id/sessions",                  listSessionsForLiveCourse);
router.get("/:id/plans",                     listLiveCoursePlans);
router.post("/:id/plans",                    autoFlushGroup("live-course"), createLiveCoursePlan);
router.get("/:id/subscriptions",             listLiveCourseSubscriptions);
router.post("/:id/grant",                    grantLiveCourseSubscription);
// Deprecated: old flat schedule-entries PATCH → 410. Old timetable-files
// route is intentionally NOT registered → 404 from the router.
router.patch("/:id/schedule-entries",        updateScheduleEntriesDeprecated);

// --- Schedule folders + entries ---------------------------------------------
router.get   ("/:id/schedule-folders",                                            listScheduleFolders);
router.post  ("/:id/schedule-folders",                                            autoFlushGroup("live-course"), createScheduleFolder);
router.post  ("/:id/schedule-folders/reorder",                                    autoFlushGroup("live-course"), reorderScheduleFolders);
router.patch ("/:id/schedule-folders/:folderId",                                  autoFlushGroup("live-course"), updateScheduleFolder);
router.delete("/:id/schedule-folders/:folderId",                                  autoFlushGroup("live-course"), deleteScheduleFolder);
router.get   ("/:id/schedule-folders/:folderId/entries",                          listScheduleEntries);
router.post  ("/:id/schedule-folders/:folderId/entries",                          autoFlushGroup("live-course"), createScheduleEntry);
router.post  ("/:id/schedule-folders/:folderId/entries/reorder",                  autoFlushGroup("live-course"), reorderScheduleEntries);
router.patch ("/:id/schedule-folders/:folderId/entries/:entryId",                 autoFlushGroup("live-course"), updateScheduleEntry);
router.delete("/:id/schedule-folders/:folderId/entries/:entryId",                 autoFlushGroup("live-course"), deleteScheduleEntry);

// --- Folder CRUD (under a live course) --------------------------------------
router.get("/:liveCourseId/folders",                       listFolders);
router.post("/:liveCourseId/folders",                      autoFlushGroup("live-course"), createFolder);
router.patch("/:liveCourseId/folders/:folderId",           autoFlushGroup("live-course"), updateFolder);
router.delete("/:liveCourseId/folders/:folderId",          autoFlushGroup("live-course"), deleteFolder);

// --- Video CRUD (under a folder) --------------------------------------------
router.get("/:liveCourseId/folders/:folderId/videos",                       listVideosInFolder);
router.post("/:liveCourseId/folders/:folderId/videos",                      autoFlushGroup("live-course"), createVideoInFolder);
router.post("/:liveCourseId/folders/:folderId/videos/reorder",              autoFlushGroup("live-course"), reorderVideosInFolder);
router.post("/:liveCourseId/folders/:folderId/videos/from-recording",       autoFlushGroup("live-course"), createVideoFromRecording);
router.get("/:liveCourseId/folders/:folderId/videos/:videoId",              getVideoInFolder);
router.put("/:liveCourseId/folders/:folderId/videos/:videoId",              autoFlushGroup("live-course"), updateVideoInFolder);
router.delete("/:liveCourseId/folders/:folderId/videos/:videoId",           autoFlushGroup("live-course"), deleteVideoInFolder);

export default router;
