import { Router } from "express";
import { enforceRbacStrict } from "../../middlewares/rbacEnforce";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
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

// Authn + admin-surface gate come from admin.routes.ts. Catalog RBAC
// (`administrators.*` in rbacRouteMap) is HARD-enforced here regardless of
// RBAC_ENFORCE — this router is the security boundary itself. Replaced the old
// requireRole("super_admin") floor 2026-09-11, which 403'd admins holding the
// permission before RBAC ran.
router.use(enforceRbacStrict);

router.get("/pre-requisites", getAdministratorPreRequisites);

router.get("/", getAdministrators);
router.post("/", uploadTo(UPLOAD_FOLDERS.users), uploadS3.single("image"), createAdministrator);
router.get("/:id", getAdministratorById);
router.put("/:id", uploadTo(UPLOAD_FOLDERS.users), uploadS3.single("image"), updateAdministrator);
router.delete("/:id", deleteAdministrator);
router.patch("/:id/status", toggleAdministratorStatus);

export default router;
