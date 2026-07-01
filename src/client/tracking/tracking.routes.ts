import { Router } from "express";
import { optionalAuthenticate } from "../../middlewares/authenticate";
import { trackEvent } from "./tracking.controller";

const router = Router();

// Best-effort auth: attach customerId when a valid token is present, otherwise
// track anonymously (a stale/invalid token must NOT block this public route).
router.post("/", optionalAuthenticate, trackEvent);

export default router;
