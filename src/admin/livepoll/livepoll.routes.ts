import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { requireRole } from "../../middlewares/authenticate";
import { createPoll, closePoll, updatePoll, deletePoll, getPollsByClass, getPollResults } from "./livepoll.controller";

const router = Router();

// All routes require admin authentication
router.use(authenticate, requireRole("admin", "super_admin", "editor"));

router.post("/", createPoll);                                  // POST   /api/v1/admin/live-polls
router.get("/:liveClassId", getPollsByClass);                 // GET    /api/v1/admin/live-polls/:liveClassId
router.get("/:pollId/results", getPollResults);               // GET    /api/v1/admin/live-polls/:pollId/results
router.patch("/:pollId/close", closePoll);                    // PATCH  /api/v1/admin/live-polls/:pollId/close
router.patch("/:pollId", updatePoll);                         // PATCH  /api/v1/admin/live-polls/:pollId
router.delete("/:pollId", deletePoll);                        // DELETE /api/v1/admin/live-polls/:pollId

export default router;
