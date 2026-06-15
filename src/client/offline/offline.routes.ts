import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getOfflineDashboard,
  // listCities,            // moved to /api/v1/client/address/cities
  // listCentersByCity,     // moved to /api/v1/client/address/cities/:cityId/centers
  listCenters,
  listBatches,
  getCenterDetail,
  getBatchDetail,
  submitEnquiry,
} from "./offline.controller";

const router = Router();

// Dashboard + browsing — public (no auth) so marketing site can surface
router.get("/", getOfflineDashboard);
// Cities + centers-by-city moved to the address module — see address.routes.ts
// router.get("/cities", listCities);
// router.get("/cities/:cityId/centers", listCentersByCity);
// Centers + batches require an authenticated customer (Bearer token).
router.get("/centers", authenticate, requireRole("customer"), listCenters);
router.get("/batches", authenticate, requireRole("customer"), listBatches);
router.get("/centers/:id", authenticate, requireRole("customer"), getCenterDetail);
router.get("/batches/:id", authenticate, requireRole("customer"), getBatchDetail);

// Enquiry accepts both anonymous and authenticated — attempt to attach userId if present
router.post("/enquiry", (req, res, next) => {
  // Best-effort auth: run authenticate but don't block if no header
  if (req.headers.authorization) {
    return authenticate(req, res, (err?: any) => {
      if (err) return next();
      return next();
    });
  }
  return next();
}, submitEnquiry);

export default router;
