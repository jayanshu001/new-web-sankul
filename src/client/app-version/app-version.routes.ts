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
router.get("/check", checkAppVersionHandler);

export default router;
