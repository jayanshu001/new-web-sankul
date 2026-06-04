import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listFaqs,
  listFaqTypes,
  getActivePopup,
  listBanners,
  listLiveBanners,
  listTestimonials,
  listSocialLinks,
  listSocialLinkTypes,
  listCurrentAffairs,
  getTerms,
  getVersion,
  checkUpgrade,
} from "./cms.controller";

const router = Router();

router.use(authenticate);

router.get("/faqs", listFaqs);
router.get("/faq-types", listFaqTypes);
router.get("/popup", getActivePopup);
router.get("/banners", listBanners);
router.get("/live-banners", listLiveBanners);
router.get("/testimonials", listTestimonials);
router.get("/social-links", listSocialLinks);
router.get("/social-link-types", listSocialLinkTypes);
router.get("/current-affairs", listCurrentAffairs);
router.get("/terms", getTerms);
router.get("/version", getVersion);
router.get("/upgrade", checkUpgrade);

export default router;
