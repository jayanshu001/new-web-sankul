import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  adminListCategories,
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
router.get("/categories", cacheRoute({ ttl: 86400, entity: "exam-countdown" }), adminListCategories);
router.post("/categories", autoFlushGroup("exam-countdown"), adminCreateCategory);
router.put("/categories/:id", autoFlushGroup("exam-countdown"), adminUpdateCategory);
router.delete("/categories/:id", autoFlushGroup("exam-countdown"), adminDeleteCategory);

// Countdowns
router.get("/", cacheRoute({ ttl: 86400, entity: "exam-countdown" }), adminListCountdowns);
router.post("/", autoFlushGroup("exam-countdown"), adminCreateCountdown);
router.put("/:id", autoFlushGroup("exam-countdown"), adminUpdateCountdown);
router.delete("/:id", autoFlushGroup("exam-countdown"), adminDeleteCountdown);

export default router;
