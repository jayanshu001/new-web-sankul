import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { listMySubscriptions } from "./my-subscriptions.controller";

const router = Router();

router.use(authenticate);

router.get("/", listMySubscriptions);

export default router;
