import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  adminListCategories,
  adminGetCategory,
  adminCreateCategory,
  adminUpdateCategory,
  adminDeleteCategory,
  adminListCountdowns,
  adminCreateCountdown,
  adminUpdateCountdown,
  adminDeleteCountdown,
} from "./examCountdown.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
// Categories
router.get("/categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown }), adminListCategories);
router.get("/categories/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown }), adminGetCategory);
router.post("/categories", autoFlushGroup(CacheEntity.ExamCountdown), adminCreateCategory);
router.put("/categories/:id", autoFlushGroup(CacheEntity.ExamCountdown), adminUpdateCategory);
router.delete("/categories/:id", autoFlushGroup(CacheEntity.ExamCountdown), adminDeleteCategory);

// Countdowns
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown }), adminListCountdowns);
router.post("/", autoFlushGroup(CacheEntity.ExamCountdown), adminCreateCountdown);
router.put("/:id", autoFlushGroup(CacheEntity.ExamCountdown), adminUpdateCountdown);
router.delete("/:id", autoFlushGroup(CacheEntity.ExamCountdown), adminDeleteCountdown);

export default router;
