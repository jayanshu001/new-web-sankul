import { Router } from "express";
import { uploadS3, uploadS3Mixed, uploadS3Document, enforceMixedSizeLimits } from "../../middlewares/upload";
import {
  getContentList,
  getContentDetail,
  createContent,
  updateContent,
  deleteContent,
  setContentStatus,
  reorderContent,
  uploadInlineImage,
  uploadDocument,
} from "./content.controller";

const router = Router();

const contentUpload = uploadS3Mixed.fields([
  { name: "featuredImage", maxCount: 1 },
  { name: "ogImage", maxCount: 1 },
]);

router.post("/reorder", reorderContent);
router.post("/inline-image", uploadS3.single("image"), uploadInlineImage);
router.post("/document", uploadS3Document.single("file"), uploadDocument);

router.get("/", getContentList);
router.post("/", contentUpload, enforceMixedSizeLimits, createContent);
router.get("/:id", getContentDetail);
router.put("/:id", contentUpload, enforceMixedSizeLimits, updateContent);
router.delete("/:id", deleteContent);
router.patch("/:id/status", setContentStatus);

export default router;
