import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { getActivePoll } from "./livepoll.controller";

const router = Router();

// GET /api/v1/client/live-polls/:liveClassId/active
router.get("/:liveClassId/active", authenticate, getActivePoll);

export default router;
