// Client tracking: analytics event route.
import { Router } from "express";
import { optionalAuthenticate } from "../../middlewares/authenticate";
import { trackEvent } from "./tracking.controller";

const router = Router();

// Best-effort auth: attaches customerId when a valid token is present, otherwise tracks
// anonymously; a stale/invalid token must not block this public route.
router.post("/", optionalAuthenticate, trackEvent);

export default router;
