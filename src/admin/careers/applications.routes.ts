import { Router } from "express";
import {
  getApplicationList,
  getApplicationDetail,
  updateApplicationStatus,
} from "./applications.controller";

const router = Router();

router.get("/", getApplicationList);
router.get("/:id", getApplicationDetail);
router.put("/:id/status", updateApplicationStatus);

export default router;
