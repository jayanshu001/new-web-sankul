import { Router } from "express";
import { checkAppVersionHandler } from "./app-version.controller";

const router = Router();

// PUBLIC — intentionally NOT behind `authenticate`. The app calls this on launch
// (force-update gate) BEFORE the user is logged in / has a valid token, so a
// Bearer requirement would deadlock a forced update. One of the documented
// auth exceptions alongside auth/refresh/webhook/health/share.
//
// Query is validated inside the controller (not via `validate({ query })`):
// Express 5 makes `req.query` getter-only, so the middleware's reassignment throws.
// NOT cached (deliberate, 2026-09-07): this is the force-update gate. Every
// launch must hit the service fresh so a newly published store version /
// changed force-update flag is honoured immediately — a cached answer here
// can keep the gate stale for the whole TTL. Do not re-add `cacheRoute`.
router.get("/check", checkAppVersionHandler);

export default router;
