import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { listMySubscriptions } from "./my-subscriptions.controller";

const router = Router();

router.use(authenticate);

router.get("/", cacheRoute({ ttl: 30, scope: "user" }), listMySubscriptions);

export default router;
