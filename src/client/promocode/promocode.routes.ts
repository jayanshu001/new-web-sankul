import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { applyPromocode, listPromocodes } from "./promocode.controller";

const router = Router();

router.use(authenticate);

router.get("/", listPromocodes);
router.post("/apply", applyPromocode);

export default router;
