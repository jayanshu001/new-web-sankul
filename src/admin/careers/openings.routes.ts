import { Router } from "express";
import {
  getOpeningList,
  getOpeningDetail,
  createOpening,
  updateOpening,
  deleteOpening,
} from "./openings.controller";

const router = Router();

router.get("/", getOpeningList);
router.post("/", createOpening);
router.get("/:id", getOpeningDetail);
router.put("/:id", updateOpening);
router.delete("/:id", deleteOpening);

export default router;
