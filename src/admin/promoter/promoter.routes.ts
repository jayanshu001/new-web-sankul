// Admin promoters: promoter CRUD and dashboard routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import {
  listPromoters,
  getPromoter,
  createPromoter,
  updatePromoter,
  deletePromoter,
  togglePromoterStatus,
  getPromoterPromocodes,
  getPromoterSubscriptions,
  getPromoterDashboard,
  getAllPromotersDashboard,
} from "./promoter.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.get("/", listPromoters);
router.post("/", uploadTo(UPLOAD_FOLDERS.promoters), uploadS3.single("image"), createPromoter);
// Static path — must precede "/:id" so it isn't captured as id="dashboard".
router.get("/dashboard", getAllPromotersDashboard);
router.get("/:id", getPromoter);
router.put("/:id", uploadTo(UPLOAD_FOLDERS.promoters), uploadS3.single("image"), updatePromoter);
router.delete("/:id", deletePromoter);
router.patch("/:id/status", togglePromoterStatus);
router.get("/:id/promocodes", getPromoterPromocodes);
router.get("/:id/subscriptions", getPromoterSubscriptions);
router.get("/:id/dashboard", getPromoterDashboard);

export default router;
