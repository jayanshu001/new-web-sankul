import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
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

router.use(authenticate, requireRole("admin", "super_admin"));

// Package Types (small master)
router.get("/types", listPackageTypes);
router.post("/types", createPackageType);
router.put("/types/:id", updatePackageType);
router.delete("/types/:id", deletePackageType);

// Packages
router.get("/", listPackages);
router.post("/", uploadS3.single("image"), createPackage);
router.post("/reorder", reorderPackages);
router.get("/:id", getPackageById);
router.put("/:id", uploadS3.single("image"), updatePackage);
router.delete("/:id", deletePackage);
router.patch("/:id/status", togglePackageStatus);

// Embedded reorders
router.patch("/:id/specific-subjects/reorder", reorderSpecificSubjects);
router.patch("/:id/material-categories/reorder", reorderMaterialCategories);
router.patch("/:id/exam-categories/reorder", reorderExamCategories);

// Plans
router.get("/:id/plans", listPackagePlans);
router.post("/:id/plans/attach", attachPlans);
router.delete("/:id/plans/:planId", detachPlan);

// Subscribers + promoted codes + linked physical books (material tab)
router.get("/:id/subscribers", listSubscribers);
router.get("/:id/promoted-codes", listPromotedCodes);
router.get("/:id/books", listBooks);

// Video-category relation management (descendant fan-out)
router.get("/:id/video-relations", listVideoRelations);
router.put("/:id/video-relations", setVideoRelations);
router.post("/:id/video-relations/expand", expandSubjectsToRelations);

// Chat
router.get("/:id/chat", listChatMessages);
router.post("/:id/chat", postChatMessage);
router.delete("/chat/:messageId", deleteChatMessage);

export default router;
