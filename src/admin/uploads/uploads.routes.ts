import { Router } from "express";
import { createPresignedUpload } from "./uploads.controller";

const router = Router();

// `authenticate` + the admin-router staff gate (admin.routes.ts) already restrict
// this to admin staff; catalog RBAC (enforceRbac) governs finer authz.
router.post("/presign", createPresignedUpload);

export default router;
