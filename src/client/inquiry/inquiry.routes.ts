import { Router } from "express";
import { submitInquiry, getContactUs } from "./inquiry.controller";

const router = Router();

// Both public (inquiry submission from marketing site / contact screen)
router.post("/inquiry", submitInquiry);
router.get("/contactus", getContactUs);

export default router;
