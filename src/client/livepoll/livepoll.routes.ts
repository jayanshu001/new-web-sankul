import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { getActivePoll } from "./livepoll.controller";

const router = Router();

router.get("/:liveClassId/active", authenticate, getActivePoll);

export default router;
