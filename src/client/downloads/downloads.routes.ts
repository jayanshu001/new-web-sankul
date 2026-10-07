// Client downloads: offline-download encryption key routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getEncryptionKeyHandler,
  putEncryptionKeyHandler,
} from "./downloads.controller";

const router = Router();

// Per-user AES-256 key: the handlers derive the owner from `req.user.id` only.
router.use(authenticate, requireRole("customer"));

// clientLimiter (app.ts) already rate-limits per user; a second limiter would
// double-count normal sync traffic. Never wrap in `cacheRoute`: a shared cache entry
// would leak one user's key to another.
router.get("/encryption-key", getEncryptionKeyHandler);
router.put("/encryption-key", putEncryptionKeyHandler);

export default router;
