import { Router } from "express";
import {
  listFaqs,
  getActivePopup,
  listBanners,
  listTestimonials,
  getTerms,
  getVersion,
  checkUpgrade,
} from "./cms.controller";

const router = Router();

// All CMS endpoints are public (no auth) — they power splash/onboarding screens.
router.get("/faqs", listFaqs);
router.get("/popup", getActivePopup);
router.get("/banners", listBanners);
router.get("/testimonials", listTestimonials);
router.get("/terms", getTerms);
router.get("/version", getVersion);
router.get("/upgrade", checkUpgrade);

export default router;
