import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { getEducatorWithCoursesHandler } from "./educator.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

// Tier-2 (embeds a per-user course isPurchased overlay via customerId) → cached
// per-user + short TTL (ebook precedent). Admin educator writes flush "educator".
router.get("/:id", cacheRoute({ ttl: 86400, entity: "educator", scope: "user" }), getEducatorWithCoursesHandler);

export default router;
