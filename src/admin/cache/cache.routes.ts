// Admin cache: route-cache flush and stats routes (admin/super_admin only).
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { flushCache, cacheStats } from "./cache.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.post("/flush", flushCache);
router.get("/stats", cacheStats);

export default router;
