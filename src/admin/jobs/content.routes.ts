import { Router } from "express";
import { uploadS3, uploadS3Mixed, uploadS3Document, enforceMixedSizeLimits, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
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

const contentUpload = [
  uploadTo(UPLOAD_FOLDERS.jobsOgImages),
  uploadS3Mixed.fields([
    { name: "featuredImage", maxCount: 1 },
    { name: "ogImage", maxCount: 1 },
  ]),
];

router.post("/reorder", reorderContent);
router.post("/inline-image", uploadTo(UPLOAD_FOLDERS.jobsEditor), uploadS3.single("image"), uploadInlineImage);
router.post("/document", uploadTo(UPLOAD_FOLDERS.jobsContentFiles), uploadS3Document.single("file"), uploadDocument);

router.get("/", getContentList);
router.post("/", contentUpload, enforceMixedSizeLimits, createContent);
router.get("/:id", getContentDetail);
router.put("/:id", contentUpload, enforceMixedSizeLimits, updateContent);
router.delete("/:id", deleteContent);
router.patch("/:id/status", setContentStatus);

export default router;
