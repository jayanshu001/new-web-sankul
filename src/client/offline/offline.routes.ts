import { Router } from "express";
import authenticate, { requireRole, optionalAuthenticate } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import {
  getOfflineDashboard,
  // listCities,            // moved to /api/v1/client/address/cities
  // listCentersByCity,     // moved to /api/v1/client/address/cities/:cityId/centers
  listCenters,
  listBatches,
  getCenterDetail,
  getBatchDetail,
  submitEnquiry,
  submitBatchEnquiry,
} from "./offline.controller";

const router = Router();

// Dashboard + browsing — public (no auth) so marketing site can surface
router.get("/", getOfflineDashboard);
// Cities + centers-by-city moved to the address module — see address.routes.ts
// router.get("/cities", listCities);
// router.get("/cities/:cityId/centers", listCentersByCity);
// Centers + batches require an authenticated customer (Bearer token).
// Center/batch masters are the same for every customer → Tier-1 shared. No
// dedicated entity tag → "misc", medium TTL. The dashboard "/" is per-user (uncached).
// Shared (identical for every customer) + entity-tagged, so admin centre/batch/
// city writes sweep these immediately instead of leaving them for the 24h TTL.
const OFFLINE = { ttl: 86400, entity: "offline" as const, scope: "shared" as const };

router.get("/centers", authenticate, requireRole("customer"), cacheRoute(OFFLINE), listCenters);
router.get("/batches", authenticate, requireRole("customer"), cacheRoute(OFFLINE), listBatches);
router.get("/centers/:id", authenticate, requireRole("customer"), cacheRoute(OFFLINE), getCenterDetail);
router.get("/batches/:id", authenticate, requireRole("customer"), cacheRoute(OFFLINE), getBatchDetail);

// Enquiry accepts both anonymous and authenticated — attach userId when a valid
// token is present; a stale/invalid token must NOT block this public route.
router.post("/enquiry", optionalAuthenticate, submitEnquiry);

// Offline-batch "Register" form — auth REQUIRED (Bearer token, customer role).
router.post("/batch-enquiry", authenticate, requireRole("customer"), submitBatchEnquiry);

export default router;
