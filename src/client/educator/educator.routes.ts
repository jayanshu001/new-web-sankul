import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { getEducatorWithCoursesHandler } from "./educator.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.get("/:id", getEducatorWithCoursesHandler);

export default router;
