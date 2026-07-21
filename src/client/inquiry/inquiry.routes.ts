import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { submitInquiry, getContactUs } from "./inquiry.controller";

const router = Router();

router.use(authenticate);
router.post("/inquiry", submitInquiry);
// Tier-1 (static contact/departments, no per-user field). No dedicated entity
// tag → "misc"; relies on the long TTL (see docs/CACHING.md).
router.get("/contactus", cacheRoute({ ttl: 86400, scope: "shared" }), getContactUs);

export default router;
