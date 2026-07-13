import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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

// CMS content is identical for every user (handlers use req.user only for logs),
// so scope:"shared" gives one cache entry across all clients — the big hit-rate
// win at client scale. Admin CMS writes flush entity "cms"/"banner"/"faq"/etc.
// which map back to these tags via the flush groups. 1h TTL (near-static).
const SHARED_1H = { ttl: 3600, scope: "shared" as const };

router.get("/faqs", cacheRoute({ ...SHARED_1H, entity: "faq" }), listFaqs);
router.get("/faq-types", cacheRoute({ ...SHARED_1H, entity: "faq" }), listFaqTypes);
router.get("/popup", cacheRoute({ ...SHARED_1H, entity: "popup" }), getActivePopup);
router.get("/banners", cacheRoute({ ...SHARED_1H, entity: "banner" }), listBanners);
router.get("/live-banners", cacheRoute({ ...SHARED_1H, entity: "banner" }), listLiveBanners);
router.get("/testimonials", cacheRoute({ ...SHARED_1H, entity: "testimonial" }), listTestimonials);
router.get("/social-links", cacheRoute({ ...SHARED_1H, entity: "social-link" }), listSocialLinks);
router.get("/social-link-types", cacheRoute({ ...SHARED_1H, entity: "social-link" }), listSocialLinkTypes);
router.get("/current-affairs", cacheRoute({ ...SHARED_1H, entity: "current-affair" }), listCurrentAffairs);
router.get("/terms", cacheRoute({ ...SHARED_1H, entity: "terms" }), getTerms);
router.get("/version", cacheRoute({ ...SHARED_1H, entity: "cms" }), getVersion);
// NOT cached: checkUpgrade evaluates per-request app-version — user/request-specific.
router.get("/upgrade", checkUpgrade);

export default router;
