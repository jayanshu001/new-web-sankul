import { Router } from "express";
import { uploadS3Mixed, enforceMixedSizeLimits } from "../../middlewares/upload";
import {
  getOrganizationList,
  getOrganizationDetail,
  createOrganization,
  updateOrganization,
  deleteOrganization,
} from "./organizations.controller";

const router = Router();
const logoUpload = uploadS3Mixed.fields([{ name: "logo", maxCount: 1 }]);

router.get("/", getOrganizationList);
router.post("/", logoUpload, enforceMixedSizeLimits, createOrganization);
router.get("/:id", getOrganizationDetail);
router.put("/:id", logoUpload, enforceMixedSizeLimits, updateOrganization);
router.delete("/:id", deleteOrganization);

export default router;
