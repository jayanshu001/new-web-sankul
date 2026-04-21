import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { applyPromocode } from "./promocode.controller";

const router = Router();

router.use(authenticate);

router.post("/apply", applyPromocode);

export default router;
