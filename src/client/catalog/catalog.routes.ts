import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getCatalogVideos,
  getCatalogMaterials,
  getCatalogTests,
} from "./catalog.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

// Unified Videos / Materials / Tests tab roots for course | package | live-course.
// :type ∈ course | package | live-course
router.get("/:type/:id/videos", getCatalogVideos);       // ?search= ?categoryIds=a,b
router.get("/:type/:id/materials", getCatalogMaterials);  // ?search=
router.get("/:type/:id/tests", getCatalogTests);          // ?search=

export default router;
