import { Router } from "express";
import { resolveMedia } from "./media.controller";

// Mounted at /api/v1/client/media (behind the master `authenticate`).
const router = Router();

router.post("/resolve", resolveMedia);

export default router;
