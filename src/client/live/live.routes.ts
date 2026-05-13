import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { getLiveSessionForClient } from "./live.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.get("/:id", getLiveSessionForClient); // GET /api/v1/client/live-sessions/:id  (id = sessionId or streamId)

export default router;
