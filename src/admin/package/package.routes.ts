import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { validate } from "../../middlewares/validate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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
router.get("/types", cacheRoute({ ttl: 86400, entity: "package-type" }), listPackageTypes);
router.post("/types", validate({ body: createPackageTypeSchema }), autoFlushGroup("package-type"), createPackageType);
router.put("/types/:id", validate({ body: updatePackageTypeSchema }), autoFlushGroup("package-type"), updatePackageType);
router.delete("/types/:id", autoFlushGroup("package-type"), deletePackageType);

// Packages
router.get("/", cacheRoute({ ttl: 86400, entity: "package" }), listPackages);
router.post("/", uploadS3.single("image"), autoFlushGroup("package"), createPackage);
router.post("/reorder", autoFlushGroup("package"), reorderPackages);
router.get("/:id", cacheRoute({ ttl: 86400, entity: "package" }), getPackageById);
router.put("/:id", uploadS3.single("image"), autoFlushGroup("package"), updatePackage);
router.delete("/:id", autoFlushGroup("package"), deletePackage);
router.patch("/:id/status", autoFlushGroup("package"), togglePackageStatus);

// Embedded reorders
router.patch("/:id/specific-subjects/reorder", autoFlushGroup("package"), reorderSpecificSubjects);
router.patch("/:id/material-categories/reorder", autoFlushGroup("package"), reorderMaterialCategories);
router.patch("/:id/exam-categories/reorder", autoFlushGroup("package"), reorderExamCategories);

// Plans
router.get("/:id/plans", listPackagePlans);
router.post("/:id/plans/attach", autoFlushGroup("package"), attachPlans);
router.delete("/:id/plans/:planId", autoFlushGroup("package"), detachPlan);

// Subscribers + promoted codes + linked physical books (material tab)
router.get("/:id/subscribers", listSubscribers);
router.get("/:id/exam-categories", listExamCategories);
router.get("/:id/material-categories", listMaterialCategories);
router.get("/:id/specific-subjects", listSpecificSubjects);
router.get("/:id/promoted-codes", listPromotedCodes);
router.get("/:id/books", listBooks);

// Video-category relation management (descendant fan-out)
router.get("/:id/video-relations", listVideoRelations);
router.put("/:id/video-relations", autoFlushGroup("package"), setVideoRelations);
router.post("/:id/video-relations/expand", autoFlushGroup("package"), expandSubjectsToRelations);

// Chat (per-subscriber, not cached — no flush)
router.get("/:id/chat", listChatMessages);
router.post("/:id/chat", postChatMessage);
router.delete("/chat/:messageId", deleteChatMessage);

export default router;
