import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  getOfflineDashboard,
  listCities,
  listCentersByCity,
  getCenterDetail,
  getBatchDetail,
  submitEnquiry,
} from "./offline.controller";

const router = Router();

// Dashboard + browsing — public (no auth) so marketing site can surface
router.get("/", getOfflineDashboard);
router.get("/cities", listCities);
router.get("/cities/:cityId/centers", listCentersByCity);
router.get("/centers/:id", getCenterDetail);
router.get("/batches/:id", getBatchDetail);

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
