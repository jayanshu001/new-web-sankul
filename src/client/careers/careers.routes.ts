import { Router } from "express";
import { validate } from "../../middlewares/validate";
import { applicationCreateSchema } from "../../modules/careers/careers.validation";
import { getCurrentOpenings, applyToOpening } from "./careers.controller";

const router = Router();

// PUBLIC — intentionally NOT behind `authenticate`. The careers page is a
// public marketing surface (no account required to browse openings or apply),
// same documented exception as auth/refresh/webhook/health/share/app-version.
// Replaces the legacy `api.websankul.com/v2/careers/*` endpoints that
// `websankul-jobs` and `websankul-books` called directly, unauthenticated —
// see docs/MIGRATION_QUERY_CHANGES.md (2026-09-18).
router.get("/current-openings", getCurrentOpenings);
router.post("/apply", validate({ body: applicationCreateSchema }), applyToOpening);

export default router;
