import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getEncryptionKeyHandler,
  putEncryptionKeyHandler,
} from "./downloads.controller";

const router = Router();

// Bearer + customer role on every route. The payload is a per-user AES-256 key,
// so there is no public or cross-role variant of these endpoints — the handlers
// derive the owner from `req.user.id` and nothing else.
router.use(authenticate, requireRole("customer"));

// Rate limiting comes from `clientLimiter`, mounted on /api/v1/client in app.ts
// (per-user, Redis-backed) — no extra limiter needed to satisfy the anti-scraping
// requirement, and a second one would double-count the app's normal sync traffic.
//
// Deliberately NOT wrapped in `cacheRoute`: the response body is a secret, and a
// shared-scope cache entry is exactly the bug that would leak one user's key to
// another. The client does its own 24h freshness window instead.
router.get("/encryption-key", getEncryptionKeyHandler);
router.put("/encryption-key", putEncryptionKeyHandler);

export default router;
