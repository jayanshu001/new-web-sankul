// Public enquiry: marketing-site lead form route.
import { Router } from "express";
import { validate } from "../../middlewares/validate";
import { publicEnquirySchema } from "../../modules/inquiry/inquiry.validation";
import { submitEnquiry } from "./inquiry.controller";

const router = Router();

// Public by design: marketing-site lead form, no account.
router.post("/", validate({ body: publicEnquirySchema }), submitEnquiry);

export default router;
