// Admin live polls: create, list, results, edit, close and delete routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { requireRole } from "../../middlewares/authenticate";
import { createPoll, closePoll, updatePoll, deletePoll, getPollsByClass, getPollResults } from "./livepoll.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.post("/", createPoll);
router.get("/:liveClassId", getPollsByClass);
router.get("/:pollId/results", getPollResults);
router.patch("/:pollId/close", closePoll);
router.patch("/:pollId", updatePoll);
router.delete("/:pollId", deletePoll);

export default router;
