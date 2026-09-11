import { Router, Request, Response } from "express";
import { enforceRbacStrict } from "../../middlewares/rbacEnforce";
import { GUARDS } from "../permission/permission.validation";

const router = Router();

// Authn + admin-surface gate come from admin.routes.ts. Catalog RBAC
// (`guards.view` in rbacRouteMap) is HARD-enforced here regardless of
// RBAC_ENFORCE. Replaced the old requireRole("super_admin") floor 2026-09-11.
router.use(enforceRbacStrict);

router.get("/", (_req: Request, res: Response) =>
  res.status(200).json({ success: true, data: { guards: GUARDS } })
);

export default router;
