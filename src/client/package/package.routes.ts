import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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

// Flat paginated listing of active packages — Tier-2 (embeds isPurchased),
// deferred to the shared/overlay phase; not cached here.
router.get("/", listPackages);

// Tier-1 (fully shared): package types are pure metadata, no per-user state.
router.get("/types", cacheRoute({ ttl: 3600, entity: "package-type", scope: "shared" }), listPackageTypes);

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
