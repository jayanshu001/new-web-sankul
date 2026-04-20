import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  getCategoryContents,
  getMaterialDetail,
  trackDownload,
  getRecentMaterials,
} from "./material.controller";

const router = Router();

router.use(authenticate);

// Tree drill-down: child categories + leaf materials at this node
router.get("/categories/:id/contents", getCategoryContents);

// Recently added materials
router.get("/recent", getRecentMaterials);

// Single material detail + download tracking
router.get("/:id", getMaterialDetail);
router.post("/:id/track-download", trackDownload);

export default router;
