import { Router } from "express";
import { resolveMedia } from "./media.controller";

// Mounted at /api/v1/client/media (behind the master `authenticate`).
const router = Router();

// POST /api/v1/client/media/resolve — exchange a media token for real media URLs.
router.post("/resolve", resolveMedia);

export default router;
