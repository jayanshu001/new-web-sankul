import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { validate } from "../../middlewares/validate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import { createPackageTypeSchema, updatePackageTypeSchema } from "./package.validation";
import {
  listPackageTypes,
  createPackageType,
  updatePackageType,
  deletePackageType,
  listPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
  togglePackageStatus,
  reorderPackages,
  reorderSpecificSubjects,
  reorderMaterialCategories,
  reorderExamCategories,
  listPackagePlans,
  attachPlans,
  detachPlan,
  listSubscribers,
  listExamCategories,
  listMaterialCategories,
  listSpecificSubjects,
  listPromotedCodes,
  listBooks,
  listVideoRelations,
  setVideoRelations,
  expandSubjectsToRelations,
  listChatMessages,
  postChatMessage,
  deleteChatMessage,
} from "./package.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on every write (see docs/CACHING.md).
// Master reads (types/list/detail) are cached; each write clears the entity + the
// client caches that embed it (package → catalog-package/dashboard/free/… ; the
// package-type group is separate).

// Package Types (small master)
router.get("/types", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.PackageType }), listPackageTypes);
router.post("/types", validate({ body: createPackageTypeSchema }), autoFlushGroup(CacheEntity.PackageType), createPackageType);
router.put("/types/:id", validate({ body: updatePackageTypeSchema }), autoFlushGroup(CacheEntity.PackageType), updatePackageType);
router.delete("/types/:id", autoFlushGroup(CacheEntity.PackageType), deletePackageType);

// Packages
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Package }), listPackages);
router.post("/", uploadS3.single("image"), autoFlushGroup(CacheEntity.Package), createPackage);
router.post("/reorder", autoFlushGroup(CacheEntity.Package), reorderPackages);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Package }), getPackageById);
router.put("/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.Package), updatePackage);
router.delete("/:id", autoFlushGroup(CacheEntity.Package), deletePackage);
router.patch("/:id/status", autoFlushGroup(CacheEntity.Package), togglePackageStatus);

// Embedded reorders
router.patch("/:id/specific-subjects/reorder", autoFlushGroup(CacheEntity.Package), reorderSpecificSubjects);
router.patch("/:id/material-categories/reorder", autoFlushGroup(CacheEntity.Package), reorderMaterialCategories);
router.patch("/:id/exam-categories/reorder", autoFlushGroup(CacheEntity.Package), reorderExamCategories);

// Plans
router.get("/:id/plans", listPackagePlans);
router.post("/:id/plans/attach", autoFlushGroup(CacheEntity.Package), attachPlans);
router.delete("/:id/plans/:planId", autoFlushGroup(CacheEntity.Package), detachPlan);

// Subscribers + promoted codes + linked physical books (material tab)
router.get("/:id/subscribers", listSubscribers);
router.get("/:id/exam-categories", listExamCategories);
router.get("/:id/material-categories", listMaterialCategories);
router.get("/:id/specific-subjects", listSpecificSubjects);
router.get("/:id/promoted-codes", listPromotedCodes);
router.get("/:id/books", listBooks);

// Video-category relation management (descendant fan-out)
router.get("/:id/video-relations", listVideoRelations);
router.put("/:id/video-relations", autoFlushGroup(CacheEntity.Package), setVideoRelations);
router.post("/:id/video-relations/expand", autoFlushGroup(CacheEntity.Package), expandSubjectsToRelations);

// Chat (per-subscriber, not cached — no flush)
router.get("/:id/chat", listChatMessages);
router.post("/:id/chat", postChatMessage);
router.delete("/chat/:messageId", deleteChatMessage);

export default router;
