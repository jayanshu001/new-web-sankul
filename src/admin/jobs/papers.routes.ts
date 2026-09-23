import { Router } from "express";
import { uploadS3Mixed, enforceMixedSizeLimits } from "../../middlewares/upload";
import {
  getPaperList,
  getPaperDetail,
  createPaper,
  updatePaper,
  deletePaper,
  uploadPaperFiles,
} from "./papers.controller";

const router = Router();
const previewUpload = uploadS3Mixed.fields([{ name: "previewImage", maxCount: 1 }]);
const filesUpload = uploadS3Mixed.array("file", 10);

router.post("/files", filesUpload, enforceMixedSizeLimits, uploadPaperFiles);

router.get("/", getPaperList);
router.post("/", previewUpload, enforceMixedSizeLimits, createPaper);
router.get("/:id", getPaperDetail);
router.put("/:id", previewUpload, enforceMixedSizeLimits, updatePaper);
router.delete("/:id", deletePaper);

export default router;
