import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { listMyPromocodes, getMyPromocode } from "./promocode.controller";

const router = Router();
router.use(authenticate, requireRole("promoter"));
router.get("/", listMyPromocodes);
router.get("/:id", getMyPromocode);

export default router;
