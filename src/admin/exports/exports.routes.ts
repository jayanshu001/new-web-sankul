import { Router } from "express";
import { createExport, getExport, downloadExport } from "./exports.controller";

const router = Router();

// `authenticate` + the admin-router staff gate (admin.routes.ts) already restrict
// this to admin staff; catalog RBAC (enforceRbac) governs finer authz. A job is
// owned by the admin who created it (ownership enforced in the controller).
router.post("/", createExport);
router.get("/:jobId", getExport);
router.get("/:jobId/download", downloadExport);

export default router;
