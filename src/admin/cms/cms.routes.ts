import { Router, Request, Response, NextFunction } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  listFaqs, getFaq, createFaq, updateFaq, deleteFaq,
  listFaqTypes, getFaqType, createFaqType, updateFaqType, deleteFaqType,
  listPopups, getPopup, createPopup, updatePopup, deletePopup,
  listBanners, getBanner, createBanner, updateBanner, deleteBanner, reorderBanners,
  listLiveBanners, getLiveBanner, createLiveBanner, updateLiveBanner, deleteLiveBanner, reorderLiveBanners,
  listTestimonials, getTestimonial, createTestimonial, updateTestimonial, deleteTestimonial,
  listSocialLinkTypes, getSocialLinkType, createSocialLinkType, updateSocialLinkType, deleteSocialLinkType,
  listSocialLinks, getSocialLink, createSocialLink, updateSocialLink, deleteSocialLink,
  listTerms, getTerms, createTerms, updateTerms, deleteTerms,
  listCurrentAffairs, getCurrentAffair, createCurrentAffair, updateCurrentAffair, deleteCurrentAffair,
  getVersion, upsertVersion,
  getAppUpdate, upsertAppUpdate,
} from "./cms.controller";

const router = Router();

const attachImage = (req: Request, _res: Response, next: NextFunction) => {
  const file = req.file as any;
  if (file?.location) req.body.image = file.location;
  next();
};

const coercePopup = (req: Request, _res: Response, next: NextFunction) => {
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  next();
};

const coerceBanner = (req: Request, _res: Response, next: NextFunction) => {
  if (typeof req.body.orderBy === "string") req.body.orderBy = Number(req.body.orderBy);
  next();
};

const attachIcon = (req: Request, _res: Response, next: NextFunction) => {
  const file = req.file as any;
  if (file?.location) req.body.icon = file.location;
  next();
};

const coerceSocialLink = (req: Request, _res: Response, next: NextFunction) => {
  if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  next();
};

const coerceCurrentAffair = (req: Request, _res: Response, next: NextFunction) => {
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  next();
};

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
// Each CMS surface tags its own entity; the flush groups also clear the client
// "cms" cache (+ dashboard for banner/testimonial). Version/app-update singletons
// are trivial and left uncached.

// FAQ
router.get("/faqs", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Faq }), listFaqs);
router.post("/faqs", autoFlushGroup(CacheEntity.Faq), createFaq);
router.get("/faqs/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Faq }), getFaq);
router.put("/faqs/:id", autoFlushGroup(CacheEntity.Faq), updateFaq);
router.delete("/faqs/:id", autoFlushGroup(CacheEntity.Faq), deleteFaq);

// FAQ Types
router.get("/faq-types", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Faq }), listFaqTypes);
router.post("/faq-types", autoFlushGroup(CacheEntity.Faq), createFaqType);
router.get("/faq-types/:id", getFaqType);
router.put("/faq-types/:id", autoFlushGroup(CacheEntity.Faq), updateFaqType);
router.delete("/faq-types/:id", autoFlushGroup(CacheEntity.Faq), deleteFaqType);

// Popup
router.get("/popups", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Popup }), listPopups);
router.post("/popups", uploadS3.single("image"), attachImage, coercePopup, autoFlushGroup(CacheEntity.Popup), createPopup);
router.get("/popups/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Popup }), getPopup);
router.put("/popups/:id", uploadS3.single("image"), attachImage, coercePopup, autoFlushGroup(CacheEntity.Popup), updatePopup);
router.delete("/popups/:id", autoFlushGroup(CacheEntity.Popup), deletePopup);

// Banner
router.get("/banners", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Banner }), listBanners);
router.post("/banners", uploadS3.single("image"), attachImage, coerceBanner, autoFlushGroup(CacheEntity.Banner), createBanner);
router.post("/banners/reorder", autoFlushGroup(CacheEntity.Banner), reorderBanners);
router.get("/banners/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Banner }), getBanner);
router.put("/banners/:id", uploadS3.single("image"), attachImage, coerceBanner, autoFlushGroup(CacheEntity.Banner), updateBanner);
router.delete("/banners/:id", autoFlushGroup(CacheEntity.Banner), deleteBanner);

// Live Banner — same flow as Banner, but `key` is implicit (always LiveCourse).
router.get("/live-banners", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Banner }), listLiveBanners);
router.post("/live-banners", uploadS3.single("image"), attachImage, coerceBanner, autoFlushGroup(CacheEntity.Banner), createLiveBanner);
router.post("/live-banners/reorder", autoFlushGroup(CacheEntity.Banner), reorderLiveBanners);
router.get("/live-banners/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Banner }), getLiveBanner);
router.put("/live-banners/:id", uploadS3.single("image"), attachImage, coerceBanner, autoFlushGroup(CacheEntity.Banner), updateLiveBanner);
router.delete("/live-banners/:id", autoFlushGroup(CacheEntity.Banner), deleteLiveBanner);

// Testimonials
router.get("/testimonials", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Testimonial }), listTestimonials);
router.post("/testimonials", autoFlushGroup(CacheEntity.Testimonial), createTestimonial);
router.get("/testimonials/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Testimonial }), getTestimonial);
router.put("/testimonials/:id", autoFlushGroup(CacheEntity.Testimonial), updateTestimonial);
router.delete("/testimonials/:id", autoFlushGroup(CacheEntity.Testimonial), deleteTestimonial);

// Social Link Types
router.get("/social-link-types", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.SocialLink }), listSocialLinkTypes);
router.post("/social-link-types", autoFlushGroup(CacheEntity.SocialLink), createSocialLinkType);
router.get("/social-link-types/:id", getSocialLinkType);
router.put("/social-link-types/:id", autoFlushGroup(CacheEntity.SocialLink), updateSocialLinkType);
router.delete("/social-link-types/:id", autoFlushGroup(CacheEntity.SocialLink), deleteSocialLinkType);

// Social Links
router.get("/social-links", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.SocialLink }), listSocialLinks);
router.post("/social-links", uploadS3.single("icon"), attachIcon, coerceSocialLink, autoFlushGroup(CacheEntity.SocialLink), createSocialLink);
router.get("/social-links/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.SocialLink }), getSocialLink);
router.put("/social-links/:id", uploadS3.single("icon"), attachIcon, coerceSocialLink, autoFlushGroup(CacheEntity.SocialLink), updateSocialLink);
router.delete("/social-links/:id", autoFlushGroup(CacheEntity.SocialLink), deleteSocialLink);

// Current Affairs — image optional on PUT; when absent, attachImage adds
// nothing and genericUpdate's $set keeps the existing image URL.
router.get("/current-affairs", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CurrentAffair }), listCurrentAffairs);
router.post("/current-affairs", uploadS3.single("image"), attachImage, coerceCurrentAffair, autoFlushGroup(CacheEntity.CurrentAffair), createCurrentAffair);
router.get("/current-affairs/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CurrentAffair }), getCurrentAffair);
router.put("/current-affairs/:id", uploadS3.single("image"), attachImage, coerceCurrentAffair, autoFlushGroup(CacheEntity.CurrentAffair), updateCurrentAffair);
router.delete("/current-affairs/:id", autoFlushGroup(CacheEntity.CurrentAffair), deleteCurrentAffair);

// Terms
router.get("/terms", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Terms }), listTerms);
router.post("/terms", autoFlushGroup(CacheEntity.Terms), createTerms);
router.get("/terms/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Terms }), getTerms);
router.put("/terms/:id", autoFlushGroup(CacheEntity.Terms), updateTerms);
router.delete("/terms/:id", autoFlushGroup(CacheEntity.Terms), deleteTerms);

// Version (singleton)
router.get("/version", getVersion);
router.put("/version", upsertVersion);

// AppUpdate (singleton)
router.get("/app-update", getAppUpdate);
router.put("/app-update", upsertAppUpdate);

export default router;
