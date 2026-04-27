import { Router, Request, Response } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { GUARDS } from "../permission/permission.validation";

const router = Router();

router.use(authenticate, requireRole("super_admin"));

router.get("/", (_req: Request, res: Response) =>
  res.status(200).json({ success: true, data: { guards: GUARDS } })
);

export default router;
