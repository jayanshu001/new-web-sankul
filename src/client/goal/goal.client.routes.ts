import { Router } from "express";
import {
  fetchActiveGoalsHandler,
  fetchMySelectedGoalsHandler,
  updateMyGoalsHandler,
} from "./goal.client.controller";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";

const router = Router();

/**
 * GOAL SELECTION ROUTES (Client)
 * Base Path: /api/v1/client/goals
 */

// Native UI endpoint
// Some apps allow fetching goals pre-login, but we can bind authenticate if needed.
// Passing authenticate ensures only logged in customers see it, but we can leave it open for onboarding.
// Tier-1 (active goals master — identical for all users). my-goals below is
// per-user and stays uncached. Admin goal writes flush "goal".
router.get("/", authenticate, cacheRoute({ ttl: 86400, entity: "goal", scope: "shared" }), fetchActiveGoalsHandler);

// Specifically fetches only the selected labels chosen by the authenticated user
router.get("/my-goals", authenticate, fetchMySelectedGoalsHandler);

// Updates the customer's selected goals + labels (also writable via /client/profile/update)
router.put("/", authenticate, updateMyGoalsHandler);

export default router;
