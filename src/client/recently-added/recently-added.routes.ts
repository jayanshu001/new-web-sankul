import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { listRecentlyAdded } from "./recently-added.controller";

const router = Router();

router.use(authenticate);
// GET /api/v1/client/recently-added — combined Planner/Smart/Live "View All" feed.
router.get("/recently-added", listRecentlyAdded);

export default router;
