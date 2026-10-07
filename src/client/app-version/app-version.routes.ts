// Client app version: public force-update check route.
import { Router } from "express";
import { checkAppVersionHandler } from "./app-version.controller";

const router = Router();

// Public by design: the app calls this on launch (force-update gate) before it has a
// valid token, so requiring auth would deadlock a forced update.
// Query is validated in the controller: Express 5 makes `req.query` getter-only, so
// `validate({ query })` reassignment throws.
// Not cached: a newly published store version / force-update flag must apply on the
// next launch. Do not add `cacheRoute`.
router.get("/check", checkAppVersionHandler);

export default router;
