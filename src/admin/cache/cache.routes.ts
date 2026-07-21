// src/admin/cache/cache.routes.ts
//
// Admin cache management routes. Secured by the same Bearer auth as the rest of
// admin, plus requireRole — NOT the old fail-open static x-cache-auth-key.
//   POST /api/v1/admin/cache/flush   { prefix? }
//   GET  /api/v1/admin/cache/stats   ?prefix=

import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { flushCache, cacheStats } from "./cache.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.post("/flush", flushCache);
router.get("/stats", cacheStats);

export default router;
