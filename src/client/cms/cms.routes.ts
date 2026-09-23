import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
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
// so scope: CacheScope.Shared gives one cache entry across all clients — the big hit-rate
// win at client scale. Admin CMS writes flush entity "cms"/"banner"/"faq"/etc.
// which map back to these tags via the flush groups. 24h TTL (near-static).
const SHARED_1H = { ttl: CACHE_TTL.DAY, scope: CacheScope.Shared as const };

router.get("/faqs", cacheRoute({ ...SHARED_1H, entity: CacheEntity.Faq }), listFaqs);
router.get("/faq-types", cacheRoute({ ...SHARED_1H, entity: CacheEntity.Faq }), listFaqTypes);
router.get("/popup", cacheRoute({ ...SHARED_1H, entity: CacheEntity.Popup }), getActivePopup);
router.get("/banners", cacheRoute({ ...SHARED_1H, entity: CacheEntity.Banner }), listBanners);
router.get("/live-banners", cacheRoute({ ...SHARED_1H, entity: CacheEntity.Banner }), listLiveBanners);
router.get("/testimonials", cacheRoute({ ...SHARED_1H, entity: CacheEntity.Testimonial }), listTestimonials);
router.get("/social-links", cacheRoute({ ...SHARED_1H, entity: CacheEntity.SocialLink }), listSocialLinks);
router.get("/social-link-types", cacheRoute({ ...SHARED_1H, entity: CacheEntity.SocialLink }), listSocialLinkTypes);
router.get("/current-affairs", cacheRoute({ ...SHARED_1H, entity: CacheEntity.CurrentAffair }), listCurrentAffairs);
router.get("/terms", cacheRoute({ ...SHARED_1H, entity: CacheEntity.Terms }), getTerms);
router.get("/version", cacheRoute({ ...SHARED_1H, entity: CacheEntity.Cms }), getVersion);
// NOT cached: checkUpgrade evaluates per-request app-version — user/request-specific.
router.get("/upgrade", checkUpgrade);

export default router;
