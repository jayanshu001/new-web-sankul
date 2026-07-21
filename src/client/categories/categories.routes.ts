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
const SHARED_CAT = { ttl: 86400, entity: "categories" as const, scope: "shared" as const };

// Video listings = Tier-3 (per-user progress + minted media tokens) → never cached.
// Other listings embed isPurchased/isCompleted → Tier-2, cached per-user + short
// TTL (ebook precedent) with the entity their admin writes flush.
router.get("/video-categories/:id/videos", listVideosByCategory);
router.get("/video-categories/:id/videos/:videoId", getVideoByCategory); // Tier-3 (per-request tokens)
router.get("/video-categories/:id/children", cacheRoute(SHARED_CAT), listVideoCategoryChildren);
router.get("/material-categories/:id/materials", cacheRoute({ ttl: 86400, entity: "material", scope: "user" }), listMaterialsByCategory);
router.get("/material-categories/:id/children", cacheRoute(SHARED_CAT), listMaterialCategoryChildren);
router.get("/exam-categories/:id/exams", cacheRoute({ ttl: 86400, entity: "catalog-exam", scope: "user" }), listExamsByCategory);
router.get("/exam-categories/:id/children", cacheRoute(SHARED_CAT), listExamCategoryChildren);
router.get("/exam-countdown-categories/:id/packages", cacheRoute({ ttl: 86400, entity: "exam-countdown", scope: "user" }), listPackagesByExamCountdownCategory);
router.get("/exam-countdown/:id/packages", cacheRoute({ ttl: 86400, entity: "exam-countdown", scope: "user" }), listProductsByExamCountdown);
router.get("/exam-countdown/:id/books-ebooks", cacheRoute({ ttl: 86400, entity: "exam-countdown", scope: "user" }), listBooksAndEbooksByExamCountdown);
router.get("/exam-countdown-categories/:id/books-ebooks", cacheRoute({ ttl: 86400, entity: "exam-countdown", scope: "user" }), listBooksAndEbooksByExamCountdownCategory);
router.get("/package-categories", cacheRoute({ ...SHARED_CAT, entity: "package-category" }), listPackageCategories);
router.get("/package-categories/:id/packages", cacheRoute({ ttl: 86400, entity: "catalog-package", scope: "user" }), listPackagesByCategory);

export default router;
