import { Router } from "express";
import { validate } from "../../middlewares/validate";
import { publicEnquirySchema } from "../../modules/inquiry/inquiry.validation";
import { submitEnquiry } from "./inquiry.controller";

const router = Router();

// PUBLIC — intentionally NOT behind `authenticate` (marketing-site lead form, no
// account). Replaces the legacy `api.websankul.com/v1/inquiry` call from websankul-jobs.
router.post("/", validate({ body: publicEnquirySchema }), submitEnquiry);

export default router;
