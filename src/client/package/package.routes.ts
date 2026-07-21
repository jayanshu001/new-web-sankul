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

// Flat paginated listing of active packages (add ?isPopular=true for the popular feed)
// Tier-2 (embeds isPurchased) — cached per-user + short TTL (ebook precedent),
// entity:"catalog-package" (admin package writes flush it).
router.get("/", cacheRoute({ ttl: 86400, entity: "catalog-package", scope: "user" }), listPackages);

// Tier-1 (fully shared): package types are pure metadata, no per-user state.
router.get("/types", cacheRoute({ ttl: 86400, entity: "package-type", scope: "shared" }), listPackageTypes);

// List packages by type — Tier-2 per-user (isPurchased overlay).
router.get("/type/:typeId", cacheRoute({ ttl: 86400, entity: "catalog-package", scope: "user" }), listPackagesByType);

// List packages grouped per goal-label — Tier-2 per-user.
// Pass labelIds as a comma-separated query string (sourced from /client/goals/my-goals)
router.get("/goal", cacheRoute({ ttl: 86400, entity: "catalog-package", scope: "user" }), listPackagesByGoal);

// Current customer's active package subscriptions — per-user, not cached.
router.get("/my", listMyPackages);

// Package chat — subscription-gated live messages, not cached.
router.get("/:packageId/chat", getChatMessages);

// Detail (catch-all — must be last) — Tier-2 per-user.
router.get("/:id", cacheRoute({ ttl: 86400, entity: "catalog-package", scope: "user" }), getPackageDetail);

export default router;
