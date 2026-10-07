// Client offline batches: dashboard, center, batch and enquiry routes.
import { Router } from "express";
import authenticate, { requireRole, optionalAuthenticate } from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  getOfflineDashboard,
  listCenters,
  listBatches,
  getCenterDetail,
  getBatchDetail,
  submitEnquiry,
  submitBatchEnquiry,
} from "./offline.controller";

const router = Router();

// Dashboard is public (no auth) so the marketing site can surface it.
router.get("/", getOfflineDashboard);
// Centers + batches require a customer token. Their masters are identical for every
// customer → shared cache, entity-tagged so admin centre/batch/city writes sweep them.
const OFFLINE = { ttl: CACHE_TTL.DAY, entity: CacheEntity.Offline as const, scope: CacheScope.Shared as const };

router.get("/centers", authenticate, requireRole("customer"), cacheRoute(OFFLINE), listCenters);
router.get("/batches", authenticate, requireRole("customer"), cacheRoute(OFFLINE), listBatches);
router.get("/centers/:id", authenticate, requireRole("customer"), cacheRoute(OFFLINE), getCenterDetail);
router.get("/batches/:id", authenticate, requireRole("customer"), cacheRoute(OFFLINE), getBatchDetail);

// Public: attaches userId when a valid token is present; a stale/invalid token must not block it.
router.post("/enquiry", optionalAuthenticate, submitEnquiry);

router.post("/batch-enquiry", authenticate, requireRole("customer"), submitBatchEnquiry);

export default router;
