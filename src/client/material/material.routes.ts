import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import {
  getCategoryContents,
  getMaterialDetail,
  trackDownload,
  getRecentMaterials,
} from "./material.controller";

const router = Router();

router.use(authenticate);

// Tier-2 (isPurchased overlay) → cached per-user + short TTL (ebook precedent),
// entity:"material" (admin material writes flush it). track-download is a write.

// Tree drill-down: child categories + leaf materials at this node
router.get("/categories/:id/contents", cacheRoute({ ttl: 86400, entity: "material", scope: "user" }), getCategoryContents);

// Recently added materials
router.get("/recent", cacheRoute({ ttl: 86400, entity: "material", scope: "user" }), getRecentMaterials);

// Single material detail + download tracking
router.get("/:id", cacheRoute({ ttl: 86400, entity: "material", scope: "user" }), getMaterialDetail);
router.post("/:id/track-download", trackDownload);

export default router;
