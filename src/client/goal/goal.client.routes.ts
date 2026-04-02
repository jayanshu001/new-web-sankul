import { Router } from "express";
import { fetchActiveGoalsHandler, fetchMySelectedGoalsHandler } from "./goal.client.controller";
import authenticate from "../../middlewares/authenticate";

const router = Router();

/**
 * GOAL SELECTION ROUTES (Client)
 * Base Path: /api/v1/client/goals
 */

// Native UI endpoint
// Some apps allow fetching goals pre-login, but we can bind authenticate if needed.
// Passing authenticate ensures only logged in customers see it, but we can leave it open for onboarding.
router.get("/", authenticate, fetchActiveGoalsHandler);

// Specifically fetches only the selected labels chosen by the authenticated user
router.get("/my-goals", authenticate, fetchMySelectedGoalsHandler);

export default router;
