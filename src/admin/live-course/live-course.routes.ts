import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
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
} from "./live-course.subscription.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// --- Plans (declared first so they don't collide with /:id patterns) -------
router.get("/plans/:planId",                 getLiveCoursePlan);
router.put("/plans/:planId",                 updateLiveCoursePlan);
router.delete("/plans/:planId",              deleteLiveCoursePlan);

// --- Subscriptions (literal prefix — also declared before /:id patterns) ----
router.get("/subscriptions",                 listLiveCourseSubscriptions);
router.get("/subscriptions/:subscriptionId", getLiveCourseSubscription);
router.put("/subscriptions/:subscriptionId", updateLiveCourseSubscription);
router.delete("/subscriptions/:subscriptionId", deleteLiveCourseSubscription);

// --- Live course CRUD -------------------------------------------------------
router.get("/",                              listLiveCourses);
router.post("/",                             uploadS3.single("image"), createLiveCourse);
router.get("/:id",                           getLiveCourseById);
router.put("/:id",                           uploadS3.single("image"), updateLiveCourse);
router.delete("/:id",                        deleteLiveCourse);
router.patch("/:id/popular",                 toggleLiveCoursePopular);
router.get("/:id/sessions",                  listSessionsForLiveCourse);
router.get("/:id/plans",                     listLiveCoursePlans);
router.post("/:id/plans",                    createLiveCoursePlan);
router.get("/:id/subscriptions",             listLiveCourseSubscriptions);
router.post("/:id/grant",                    grantLiveCourseSubscription);
// Deprecated: old flat schedule-entries PATCH → 410. Old timetable-files
// route is intentionally NOT registered → 404 from the router.
router.patch("/:id/schedule-entries",        updateScheduleEntriesDeprecated);

// --- Schedule folders + entries ---------------------------------------------
router.get   ("/:id/schedule-folders",                                            listScheduleFolders);
router.post  ("/:id/schedule-folders",                                            createScheduleFolder);
router.post  ("/:id/schedule-folders/reorder",                                    reorderScheduleFolders);
router.patch ("/:id/schedule-folders/:folderId",                                  updateScheduleFolder);
router.delete("/:id/schedule-folders/:folderId",                                  deleteScheduleFolder);
router.get   ("/:id/schedule-folders/:folderId/entries",                          listScheduleEntries);
router.post  ("/:id/schedule-folders/:folderId/entries",                          createScheduleEntry);
router.post  ("/:id/schedule-folders/:folderId/entries/reorder",                  reorderScheduleEntries);
router.patch ("/:id/schedule-folders/:folderId/entries/:entryId",                 updateScheduleEntry);
router.delete("/:id/schedule-folders/:folderId/entries/:entryId",                 deleteScheduleEntry);

// --- Folder CRUD (under a live course) --------------------------------------
router.get("/:liveCourseId/folders",                       listFolders);
router.post("/:liveCourseId/folders",                      createFolder);
router.patch("/:liveCourseId/folders/:folderId",           updateFolder);
router.delete("/:liveCourseId/folders/:folderId",          deleteFolder);

// --- Video CRUD (under a folder) --------------------------------------------
router.get("/:liveCourseId/folders/:folderId/videos",                       listVideosInFolder);
router.post("/:liveCourseId/folders/:folderId/videos",                      createVideoInFolder);
router.post("/:liveCourseId/folders/:folderId/videos/reorder",              reorderVideosInFolder);
router.post("/:liveCourseId/folders/:folderId/videos/from-recording",       createVideoFromRecording);
router.get("/:liveCourseId/folders/:folderId/videos/:videoId",              getVideoInFolder);
router.put("/:liveCourseId/folders/:folderId/videos/:videoId",              updateVideoInFolder);
router.delete("/:liveCourseId/folders/:folderId/videos/:videoId",           deleteVideoInFolder);

export default router;
