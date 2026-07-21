import { Router } from "express";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { checkAppVersionHandler } from "./app-version.controller";

const router = Router();

// PUBLIC — intentionally NOT behind `authenticate`. The app calls this on launch
// (force-update gate) BEFORE the user is logged in / has a valid token, so a
// Bearer requirement would deadlock a forced update. One of the documented
// auth exceptions alongside auth/refresh/webhook/health/share.
//
// Query is validated inside the controller (not via `validate({ query })`):
// Express 5 makes `req.query` getter-only, so the middleware's reassignment throws.
// Tier-1 shared config; query params (platform/version) are auto-keyed by the
// cache's normalized-query handling. No entity tag → "misc", short TTL.
router.get("/check", cacheRoute({ ttl: 86400, scope: "shared" }), checkAppVersionHandler);

export default router;
