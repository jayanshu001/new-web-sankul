import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { autoFlush } from "../../middlewares/autoFlush";
import { pinMostPopular, recomputeMostPopular } from "./plan-popularity.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// These flip is_most_popular, embedded in plan/catalog product responses — flush
// "plan" (fans out to catalog-package/course/ebook + dashboard + free) so the
// pinned-badge change surfaces immediately, not after the cached read's TTL.
router.post("/pin", autoFlush("plan"), pinMostPopular);            // POST /api/v1/admin/plan-popularity/pin
router.post("/recompute", autoFlush("plan"), recomputeMostPopular); // POST /api/v1/admin/plan-popularity/recompute

export default router;
