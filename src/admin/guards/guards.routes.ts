// Admin guards: lists the RBAC guard catalog (strict permission check).
import { Router, Request, Response } from "express";
import { enforceRbacStrict } from "../../middlewares/rbacEnforce";
import { GUARDS } from "../permission/permission.validation";

const router = Router();

// Authn + admin-surface gate come from admin.routes.ts. Catalog RBAC
// (`guards.view`) is hard-enforced here regardless of RBAC_ENFORCE.
router.use(enforceRbacStrict);

router.get("/", (_req: Request, res: Response) =>
  res.status(200).json({ success: true, data: { guards: GUARDS } })
);

export default router;
