import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listCategories,
  listCountdowns,
  upcomingCountdowns,
} from "./examCountdown.controller";

const router = Router();

router.use(authenticate);

router.get("/categories", listCategories);
router.get("/upcoming", upcomingCountdowns);
router.get("/", listCountdowns);

export default router;
