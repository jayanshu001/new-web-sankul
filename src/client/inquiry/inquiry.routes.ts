// Client inquiry: inquiry submit and contact-us routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { submitInquiry, getContactUs } from "./inquiry.controller";

const router = Router();

router.use(authenticate);
router.post("/inquiry", submitInquiry);
// Static contact/departments with no per-user field → shared cache.
router.get("/contactus", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ContactDepartment, scope: CacheScope.Shared }), getContactUs);

export default router;
