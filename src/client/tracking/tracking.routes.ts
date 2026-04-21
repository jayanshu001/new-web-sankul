import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { trackEvent } from "./tracking.controller";

const router = Router();

// Best-effort auth: attach customerId if header present, otherwise allow anonymous track.
router.post("/", (req, res, next) => {
  if (req.headers.authorization) {
    return authenticate(req, res, (err?: any) => (err ? next() : next()));
  }
  return next();
}, trackEvent);

export default router;
