// Client subscription access: offline download and access routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { getSubscriptionAccess, registerOfflineDownload } from "./subscriptions.controller";

const router = Router();

// Customer role only; each route derives its owner from `req.user.id` alone.
router.use(authenticate, requireRole("customer"));

// Records which product an offline video download was taken under. Idempotent on
// (customer, video, kind, id), so the app can retry freely.
router.post("/downloads", registerOfflineDownload);

// Deliberately not cached: this is the app's only online signal that an admin revoked
// a subscription, and any TTL lets a revoked offline download keep playing. The
// response is ids + timestamps only, and `clientLimiter` (app.ts) still rate-limits it.
router.get("/access", getSubscriptionAccess);

export default router;
