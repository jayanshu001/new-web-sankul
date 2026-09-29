import { Router } from "express";
import { uploadS3Mixed, enforceMixedSizeLimits, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import {
  getOrganizationList,
  getOrganizationDetail,
  createOrganization,
  updateOrganization,
  deleteOrganization,
} from "./organizations.controller";

const router = Router();
const logoUpload = [uploadTo(UPLOAD_FOLDERS.jobsOrganizations), uploadS3Mixed.fields([{ name: "logo", maxCount: 1 }])];

router.get("/", getOrganizationList);
router.post("/", logoUpload, enforceMixedSizeLimits, createOrganization);
router.get("/:id", getOrganizationDetail);
router.put("/:id", logoUpload, enforceMixedSizeLimits, updateOrganization);
router.delete("/:id", deleteOrganization);

export default router;
