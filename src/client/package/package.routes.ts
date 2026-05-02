import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  getPackageDetail,
  listPackages,
  listPackagesByType,
  listPackagesByGoal,
  listPackageTypes,
  listMyPackages,
  getChatMessages,
} from "./package.controller";

const router = Router();

router.use(authenticate);

// Flat paginated listing of active packages
router.get("/", listPackages);

// Discover package types (public-facing list)
router.get("/types", listPackageTypes);

// List packages by type
router.get("/type/:typeId", listPackagesByType);

// List packages grouped per goal-label
// Pass labelIds as a comma-separated query string (sourced from /client/goals/my-goals)
router.get("/goal", listPackagesByGoal);

// Current customer's active package subscriptions
router.get("/my", listMyPackages);

// Package chat — subscription-gated
router.get("/:packageId/chat", getChatMessages);

// Detail (catch-all — must be last)
router.get("/:id", getPackageDetail);

export default router;
