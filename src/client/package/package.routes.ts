import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  getPackageDetail,
  listPackagesByType,
  listPackageTypes,
  listMyPackages,
  getChatMessages,
} from "./package.controller";

const router = Router();

router.use(authenticate);

// Discover package types (public-facing list)
router.get("/types", listPackageTypes);

// List packages by type
router.get("/type/:typeId", listPackagesByType);

// Current customer's active package subscriptions
router.get("/my", listMyPackages);

// Package chat — subscription-gated
router.get("/:packageId/chat", getChatMessages);

// Detail (catch-all — must be last)
router.get("/:id", getPackageDetail);

export default router;
