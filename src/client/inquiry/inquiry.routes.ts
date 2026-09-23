import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { submitInquiry, getContactUs } from "./inquiry.controller";

const router = Router();

router.use(authenticate);
router.post("/inquiry", submitInquiry);
// Tier-1 (static contact/departments, no per-user field). No dedicated entity
// tag → "misc"; relies on the long TTL (see docs/CACHING.md).
router.get("/contactus", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ContactDepartment, scope: CacheScope.Shared }), getContactUs);

export default router;
