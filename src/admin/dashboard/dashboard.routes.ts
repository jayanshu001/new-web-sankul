import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { getDashboard } from "./dashboard.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate
router.get("/", getDashboard);

export default router;
