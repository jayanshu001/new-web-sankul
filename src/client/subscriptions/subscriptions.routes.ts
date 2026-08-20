import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { getSubscriptionAccess, registerOfflineDownload } from "./subscriptions.controller";

const router = Router();

// Bearer + customer role on both routes. Each derives its owner from
// `req.user.id` alone — there is no public or cross-role variant of either the
// registration ledger or the access snapshot.
router.use(authenticate, requireRole("customer"));

// Records which product a just-completed offline video download was taken under.
// Idempotent on (customer, video, kind, id), so the app can retry freely.
router.post("/downloads", registerOfflineDownload);

// Deliberately NOT wrapped in `cacheRoute`. This is the app's only online signal
// that an admin revoked a subscription; any TTL here is a window in which a
// revoked offline download keeps playing. Rate limiting still applies via the
// per-user `clientLimiter` mounted on /api/v1/client in app.ts. The response is
// ids + timestamps only, so an uncached read stays cheap.
router.get("/access", getSubscriptionAccess);

export default router;
