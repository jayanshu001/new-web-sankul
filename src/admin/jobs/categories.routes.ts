import { Router } from "express";
import { uploadS3Mixed, enforceMixedSizeLimits, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import {
  getCategoryList,
  getCategoryDetail,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from "./categories.controller";

const router = Router();
const imageUpload = [uploadTo(UPLOAD_FOLDERS.jobsCategories), uploadS3Mixed.fields([{ name: "image", maxCount: 1 }])];

router.post("/reorder", reorderCategories);
router.get("/", getCategoryList);
router.post("/", imageUpload, enforceMixedSizeLimits, createCategory);
router.get("/:id", getCategoryDetail);
router.put("/:id", imageUpload, enforceMixedSizeLimits, updateCategory);
router.delete("/:id", deleteCategory);

export default router;
