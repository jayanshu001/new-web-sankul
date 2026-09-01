import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import { recomputeMostPopular } from "./plan-popularity.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// The badge is fully automatic — the POST /pin override was removed 2026-08-05
// with the most_popular_pinned column. Only the manual recompute remains.
//
// Recompute flips is_most_popular, which is embedded in plan/catalog product
// responses — so expand the GROUP (autoFlushGroup, not autoFlush: the latter
// clears only the "plan" tag itself and would leave every catalog/admin-product
// read stale). "plan" covers course/package/ebook plan rows + their client
// catalogs; "live-course" covers ws_live_course_plan, whose rows surface in the
// live-course and package-category listings; "test-series" covers
// ws_test_series_price, whose is_most_popular surfaces in the cached client
// test-series list/detail (those reads were untagged until the "test-series"
// entity was added, which is why this comment previously read "not cached").
router.post("/recompute", autoFlushGroup("plan", "live-course", "test-series"), recomputeMostPopular); // POST /api/v1/admin/plan-popularity/recompute

export default router;
