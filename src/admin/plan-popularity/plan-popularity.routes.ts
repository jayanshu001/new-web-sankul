// Admin plan popularity: "Most Popular" recompute route.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import { CacheEntity } from "../../middlewares/flushGroups";
import { recomputeMostPopular } from "./plan-popularity.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// is_most_popular is embedded in plan/catalog product responses, so flush the
// GROUP (autoFlushGroup; autoFlush would clear only the "plan" tag and leave
// catalog reads stale). "plan" covers course/package/ebook plans + client catalogs,
// "live-course" covers ws_live_course_plan (live-course and package-category
// listings), "test-series" covers ws_test_series_price (client test-series reads).
router.post("/recompute", autoFlushGroup(CacheEntity.Plan, CacheEntity.LiveCourse, CacheEntity.TestSeries), recomputeMostPopular);

export default router;
