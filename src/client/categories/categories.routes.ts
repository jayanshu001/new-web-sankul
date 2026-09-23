import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
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
// categories list carry no per-user state. scope: CacheScope.Shared, 5-min TTL.
const SHARED_CAT = { ttl: CACHE_TTL.DAY, entity: CacheEntity.Categories as const, scope: CacheScope.Shared as const };

// Video listings = Tier-3 (per-user progress + minted media tokens) → never cached.
// Other listings embed isPurchased/isCompleted → Tier-2, cached per-user + short
// TTL (ebook precedent) with the entity their admin writes flush.
router.get("/video-categories/:id/videos", listVideosByCategory);
router.get("/video-categories/:id/videos/:videoId", getVideoByCategory); // Tier-3 (per-request tokens)
router.get("/video-categories/:id/children", cacheRoute(SHARED_CAT), listVideoCategoryChildren);
router.get("/material-categories/:id/materials", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material, scope: CacheScope.User }), listMaterialsByCategory);
router.get("/material-categories/:id/children", cacheRoute(SHARED_CAT), listMaterialCategoryChildren);
router.get("/exam-categories/:id/exams", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CatalogExam, scope: CacheScope.User }), listExamsByCategory);
router.get("/exam-categories/:id/children", cacheRoute(SHARED_CAT), listExamCategoryChildren);
router.get("/exam-countdown-categories/:id/packages", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown, scope: CacheScope.User }), listPackagesByExamCountdownCategory);
router.get("/exam-countdown/:id/packages", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown, scope: CacheScope.User }), listProductsByExamCountdown);
router.get("/exam-countdown/:id/books-ebooks", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown, scope: CacheScope.User }), listBooksAndEbooksByExamCountdown);
router.get("/exam-countdown-categories/:id/books-ebooks", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown, scope: CacheScope.User }), listBooksAndEbooksByExamCountdownCategory);
router.get("/package-categories", cacheRoute({ ...SHARED_CAT, entity: CacheEntity.PackageCategory }), listPackageCategories);
router.get("/package-categories/:id/packages", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CatalogPackage, scope: CacheScope.User }), listPackagesByCategory);

export default router;
