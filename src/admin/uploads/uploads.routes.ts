import { Router } from "express";
import { requireRole } from "../../middlewares/authenticate";
import { createPresignedUpload } from "./uploads.controller";

const router = Router();

// `authenticate` is already applied at the admin-router level (admin.routes.ts);
// we additionally gate presign issuance to admins/super-admins/editors who can
// create/update content.
router.post(
  "/presign",
  requireRole("admin", "super_admin", "editor"),
  createPresignedUpload
);

export default router;
