import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import {
  getAdministrators,
  getAdministratorById,
  getAdministratorPreRequisites,
  createAdministrator,
  updateAdministrator,
  deleteAdministrator,
  toggleAdministratorStatus,
} from "./administrator.controller";

const router = Router();

router.use(authenticate, requireRole("super_admin"));

router.get("/pre-requisites", getAdministratorPreRequisites);

router.get("/", getAdministrators);
router.post("/", uploadS3.single("image"), createAdministrator);
router.get("/:id", getAdministratorById);
router.put("/:id", uploadS3.single("image"), updateAdministrator);
router.delete("/:id", deleteAdministrator);
router.patch("/:id/status", toggleAdministratorStatus);

export default router;
