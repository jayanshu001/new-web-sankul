import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { submitInquiry, getContactUs } from "./inquiry.controller";

const router = Router();

router.use(authenticate);
router.post("/inquiry", submitInquiry);
router.get("/contactus", getContactUs);

export default router;
