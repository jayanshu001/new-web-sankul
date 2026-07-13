import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import {
  listVideosByCategory,
  getVideoByCategory,
  listMaterialsByCategory,
  listExamsByCategory,
  listVideoCategoryChildren,
  listMaterialCategoryChildren,
  listExamCategoryChildren,
  listPackagesByExamCountdownCategory,
  listProductsByExamCountdown,
  listBooksAndEbooksByExamCountdownCategory,
  listBooksAndEbooksByExamCountdown,
  listPackageCategories,
  listPackagesByCategory,
} from "./categories.controller";

const router = Router();

router.use(authenticate);

// Tier-1 (fully shared): category tree `/children` drill-downs + the package-
// categories list carry no per-user state. scope:"shared", 5-min TTL.
const SHARED_CAT = { ttl: 300, entity: "categories" as const, scope: "shared" as const };

// Tier-2 (embed progress/isPurchased/isCompleted) → deferred, NOT cached:
router.get("/video-categories/:id/videos", listVideosByCategory);
router.get("/video-categories/:id/videos/:videoId", getVideoByCategory); // Tier-3 (per-request tokens)
router.get("/video-categories/:id/children", cacheRoute(SHARED_CAT), listVideoCategoryChildren);
router.get("/material-categories/:id/materials", listMaterialsByCategory);
router.get("/material-categories/:id/children", cacheRoute(SHARED_CAT), listMaterialCategoryChildren);
router.get("/exam-categories/:id/exams", listExamsByCategory);
router.get("/exam-categories/:id/children", cacheRoute(SHARED_CAT), listExamCategoryChildren);
router.get("/exam-countdown-categories/:id/packages", listPackagesByExamCountdownCategory);
router.get("/exam-countdown/:id/packages", listProductsByExamCountdown);
router.get("/exam-countdown/:id/books-ebooks", listBooksAndEbooksByExamCountdown);
router.get("/exam-countdown-categories/:id/books-ebooks", listBooksAndEbooksByExamCountdownCategory);
router.get("/package-categories", cacheRoute({ ...SHARED_CAT, entity: "package-category" }), listPackageCategories);
router.get("/package-categories/:id/packages", listPackagesByCategory);

export default router;
